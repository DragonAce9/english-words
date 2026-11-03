import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { makeInitData } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { FREE_THEME_IDS } from "./access.js";
import { dictionary, getDictionary } from "./dictionary.js";
import { migrate } from "./migrate.js";
import { recallAcceptsAnswer, recallAnswerCorrect } from "./recall.js";
import { PET } from "./pet.js";
import { setClassifyUnknown } from "./ai.js";
import { SESSION_MAX } from "./session.js";
import { shortSubtitleLine } from "./subtitleLine.js";
import { themeForMediaWord } from "./interests.js";
import { availableLanguages, namedLanguages } from "./languages.js";
import { readThemeFile, writeThemeFile } from "./themeFile.js";
import {
  createTeacher as insertTeacher,
  deleteTeacher as removeTeacherRow,
  isListedTeacher,
  listTeachers,
  acceptTeacherApplication,
  approveTeacherApplication,
  parseTeacherApplicationMessage,
  rejectTeacherApplication,
  setTeacherApplicationNotifier,
  setTeacherAvatarLookup,
  setTelegramTeacherLookup,
} from "./teachers.js";
import { signTributeBody } from "./tribute.js";
import type { AppUser, DictWord } from "./types.js";

const LANGUAGE_COUNT_TABLES = [
  "users",
  "word_progress",
  "user_words",
  "user_study_words",
  "user_studying",
  "catalog_words",
] as const;
const languageTableCounts: { table: string; before: number; after: number }[] = [];

const app = createApp();
const telegramUserId = 9_001_001;
const botToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;

function authHeaders() {
  if (config.allowDevAuth && config.botToken.includes("replace-me")) {
    return { Authorization: "dev" };
  }
  return { Authorization: `tma ${makeInitData(botToken, telegramUserId)}` };
}

async function json(path: string, init?: RequestInit) {
  const response = await app.request(path, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function unfile(wordId: string) {
  for (const themeId of dictionary.themesFor(wordId)) {
    const theme = await readThemeFile(themeId);
    if (!theme?.words.some((word) => word.id === wordId)) continue;
    theme.words = theme.words.filter((word) => word.id !== wordId);
    await writeThemeFile(theme);
  }
  dictionary.forget(wordId);
}

async function countTable(table: (typeof LANGUAGE_COUNT_TABLES)[number]): Promise<number> {
  const rows = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  await sql`DELETE FROM user_words WHERE word_id IN ('flibberwock', 'zindlequark')`;
  const beforeCounts = new Map<string, number>();
  for (const table of LANGUAGE_COUNT_TABLES) beforeCounts.set(table, await countTable(table));
  await migrate();
  for (const table of LANGUAGE_COUNT_TABLES) {
    languageTableCounts.push({ table, before: beforeCounts.get(table) ?? 0, after: await countTable(table) });
  }
  await sql`DELETE FROM catalog_words WHERE word_id IN ('flibberwock', 'zindlequark')`;
  await dictionary.load();
  await unfile("flibberwock");
  await unfile("zindlequark");
  await sql`DELETE FROM pets WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM user_studying WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM user_study_words WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM user_free_media WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
  await sql`DELETE FROM tribute_events WHERE event_id LIKE ${`%:4242:%`} OR event_id LIKE ${`%:4243:%`}`;
  process.env.ALLOW_DEV_AUTH = "false";
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

function catalogListings(): number {
  return [...dictionary.themes.values()].reduce((sum, theme) => sum + theme.words.length, 0);
}

function overlappingWord(): { wordId: string; themeIds: string[] } {
  for (const [wordId, themeIds] of dictionary.wordThemes) {
    const catalog = themeIds.filter((id) => {
      const theme = dictionary.getTheme(id);
      return theme && !dictionary.isMediaPack(theme);
    });
    if (catalog.length < 2) continue;
    const copies = catalog.map((id) => dictionary.getTheme(id)?.words.find((word) => word.id === wordId));
    const sameEn = new Set(copies.map((word) => word?.en)).size === 1;
    const sameRu = new Set(copies.map((word) => JSON.stringify(word?.ru))).size === 1;
    if (sameEn && sameRu) return { wordId, themeIds: catalog };
  }
  throw new Error("expected at least one word in two themes");
}

describe("health and metrics", () => {
  it("reports loaded dictionary as unique word ids", async () => {
    const { status, body } = await json("/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.words).toBe(dictionary.words.size);
    expect(body.words).toBeGreaterThanOrEqual(36);
    expect(catalogListings()).toBeGreaterThan(dictionary.words.size);
    expect(dictionary.words.has("airport")).toBe(true);
    expect(dictionary.words.has("travel.airport")).toBe(false);
  });

  it("exposes prometheus metrics", async () => {
    const response = await app.request("/metrics");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toMatch(/session_started|http_request_duration_ms|# TYPE/);
  });

  it("serves terms and privacy without auth", async () => {
    const terms = await app.request("/terms");
    const privacy = await app.request("/privacy");
    expect(terms.status).toBe(200);
    expect(privacy.status).toBe(200);
    expect(terms.headers.get("content-type")).toMatch(/html/);
    const termsHtml = await terms.text();
    const privacyHtml = await privacy.text();
    expect(termsHtml).toContain("Условия использования");
    expect(privacyHtml).toContain("Политика конфиденциальности");
    expect(termsHtml).toContain("/support");
    expect(termsHtml).toContain("ответ придёт от нас");
    expect(termsHtml).not.toContain("@contact");
    expect(termsHtml).toContain('href="/privacy"');
    expect(privacyHtml).toContain("/support");
    expect(privacyHtml).toContain("<li>");
    expect(privacyHtml).toContain('href="/terms"');
  });
});

describe("initData auth", () => {
  it("rejects invalid HMAC", async () => {
    const response = await app.request("/themes", {
      headers: { Authorization: "tma hash=deadbeef&user=%7B%22id%22%3A1%7D" },
    });
    expect(response.status).toBe(401);
  });

  it("accepts signed initData when token is real", async () => {
    const original = config.botToken;
    (config as { botToken: string }).botToken = "test-bot-token";
    (config as { allowDevAuth: boolean }).allowDevAuth = false;
    const initData = makeInitData("test-bot-token", telegramUserId);
    const response = await app.request("/themes", {
      headers: { Authorization: `tma ${initData}` },
    });
    (config as { botToken: string }).botToken = original;
    (config as { allowDevAuth: boolean }).allowDevAuth = true;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { themes: { id: string; locked: boolean }[] };
    const ids = body.themes.map((theme) => theme.id);
    expect(ids.slice(0, 3)).toEqual(["travel", "food", "daily"]);
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });
});

describe("themes, sessions, progress", () => {
  it("keeps general as a leftover bucket and has more than the original 15 themes", () => {
    const general = dictionary.getTheme("general");
    expect(general).toBeTruthy();
    expect(general!.title).toBe("Общее");
    expect(general!.words.length).toBeLessThan(400);
    expect(general!.words.length).toBeGreaterThanOrEqual(12);
    const descriptions = dictionary.listBlocks().find((block) => block.id === "descriptions");
    expect(descriptions?.title).toBe("Описание");
    expect(descriptions!.themeIds.length).toBeGreaterThan(1);
    const interests = dictionary.listBlocks().find((block) => block.id === "interests");
    expect(interests?.title).toBe("Интересы");
    expect(interests!.themeIds.length).toBeGreaterThan(5);
    let missingCategory = 0;
    for (const theme of dictionary.themes.values()) {
      if (dictionary.isMediaPack(theme) || theme.kind === "text") continue;
      expect(theme.words.length).toBeLessThanOrEqual(1000);
    }
    for (const theme of dictionary.themes.values()) {
      if (!dictionary.isMediaPack(theme)) continue;
      for (const word of theme.words) {
        if (!dictionary.catalogThemeIdFor(word.id)) missingCategory += 1;
      }
    }
    expect(missingCategory).toBe(0);
    expect(dictionary.themes.size).toBeGreaterThan(20);
    expect(dictionary.words.size).toBeGreaterThanOrEqual(36);
    expect(dictionary.getTheme("travel")?.paid).toBe(false);
    expect(dictionary.getTheme("family")?.paid).toBe(false);
    expect(dictionary.getTheme("food")?.paid).toBe(false);
    expect(dictionary.getTheme("health")?.paid).toBe(true);
    expect(dictionary.getTheme("travel")?.words.length).toBeGreaterThanOrEqual(12);
    const connectors = dictionary.getTheme("connectors");
    const irregulars = dictionary.getTheme("irregular-verbs");
    const popular = dictionary.getTheme("popular-verbs");
    expect(connectors?.title).toBe("Слова-связки");
    expect(connectors?.paid).toBe(true);
    expect(connectors!.words.length).toBeGreaterThanOrEqual(40);
    expect(irregulars?.title).toBe("Неправильные глаголы");
    expect(irregulars?.paid).toBe(true);
    expect(irregulars!.words.length).toBeGreaterThanOrEqual(80);
    expect(irregulars!.words.some((word) => word.en.includes(" / "))).toBe(true);
    expect(irregulars!.words.find((word) => word.id === "go-went-gone")?.en).toBe("go / went / gone");
    expect(popular?.title).toBe("Самые популярные глаголы");
    expect(popular?.paid).toBe(true);
    expect(popular!.words.length).toBeGreaterThanOrEqual(100);
    for (const theme of dictionary.themes.values()) {
      if ((FREE_THEME_IDS as readonly string[]).includes(theme.id)) {
        expect(theme.paid).toBe(false);
        continue;
      }
      expect(theme.paid).toBe(true);
    }
  });

  it("lists themes without word bodies and locks paid ones", async () => {
    (config as { allowDevAuth: boolean }).allowDevAuth = true;
    (config as { devTelegramUserId: number }).devTelegramUserId = telegramUserId;
    const { status, body } = await json("/themes");
    expect(status).toBe(200);
    expect(body.themes[0].id).toBe("travel");
    expect(body.themes.find((theme: { id: string }) => theme.id === "travel").locked).toBe(false);
    expect(body.themes.find((theme: { id: string }) => theme.id === "food").locked).toBe(false);
    expect(body.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(true);
    expect(body.themes[0].words).toBeUndefined();
    expect(body.themes[0].wordCount).toBeGreaterThanOrEqual(12);
    expect(body.themes[0].knownCount).toBe(0);
    expect(body.themes[0].levels.A1 + body.themes[0].levels.A2).toBeGreaterThan(0);
    expect(body.themes[0].blockId).toBe("world");
    expect(body.themes.length).toBe(dictionary.themes.size);
    expect(body.subscribed).toBe(false);
    expect(body.listedTeacher).toBe(false);
    expect(body.botUsername).toBe("YOUR_BOT_USERNAME");
    expect(body.catalogWordCount).toBe(dictionary.words.size);
    expect(body.catalogWordCount).toBeGreaterThanOrEqual(36);
    expect(body.blocks.length).toBeGreaterThanOrEqual(5);
    expect(body.blocks[0].themeIds.length).toBeGreaterThan(0);
    expect(body.blocks.some((block: { id: string }) => block.id === "world")).toBe(true);
  });

  it("tags words with CEFR and groups themes into blocks", () => {
    const travel = dictionary.getTheme("travel");
    expect(travel?.blockId).toBe("world");
    expect(travel!.words.every((word) => ["A1", "A2", "B1", "B2", "C1", "C2"].includes(word.level))).toBe(
      true,
    );
    expect(dictionary.listBlocks().length).toBeGreaterThanOrEqual(5);
    const numbers = dictionary.getTheme("numbers");
    expect(numbers?.words.find((word) => word.id === "eighteen")?.level).toBe("A1");
    expect(numbers?.words.find((word) => word.id === "ninety")?.level).toBe("A1");
    expect(numbers?.words.find((word) => word.id === "quarterdeck")).toBeUndefined();
    expect(numbers?.words.find((word) => word.id === "bother")).toBeUndefined();
    const colors = dictionary.getTheme("colors");
    expect(colors?.words.find((word) => word.id === "orange")?.level).toBe("A1");
    expect(colors?.words.find((word) => word.id === "beige")?.level).toBe("A2");
    expect(colors?.words.find((word) => word.id === "environmentalist")).toBeUndefined();
    const family = dictionary.getTheme("family");
    expect(family?.words.find((word) => word.id === "grandmother")?.level).toBe("A1");
    expect(family?.words.find((word) => word.id === "groomer")).toBeUndefined();
    expect(dictionary.getTheme("grammar")?.words.find((word) => word.id === "hers")?.level).toBe("A2");
    expect(dictionary.getTheme("shopping")?.words.find((word) => word.id === "counter-attack")).toBeUndefined();
    expect(dictionary.getTheme("weather")?.words.find((word) => word.id === "rainy")?.level).toBe("A2");
    expect(dictionary.getTheme("home")?.words.find((word) => word.id === "sofa")?.level).toBe("A1");
  });

  it("starts a travel session with a 12–20 word pack and match rounds", async () => {
    const { status, body } = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "travel", mode: "learn" }),
    });
    expect(status).toBe(200);
    expect(body.words.length).toBeGreaterThanOrEqual(12);
    expect(body.words.length).toBeLessThanOrEqual(20);
    expect(body.choices.length).toBeGreaterThan(0);
    expect(body.matchRounds.length).toBeGreaterThanOrEqual(2);
    expect(body.matchRounds[0][0].en).toBeTruthy();
    expect(body.level).toBeNull();
    expect(body.categoryId).toBeNull();
    const listed = await json("/themes");
    const travel = listed.body.themes.find((theme: { id: string }) => theme.id === "travel");
    expect(travel.studying).toBe(true);
  });

  it("removes a theme from studying without clearing word progress", async () => {
    await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "travel", mode: "learn" }),
    });
    const before = await json("/themes");
    const travelBefore = before.body.themes.find((theme: { id: string }) => theme.id === "travel");
    expect(travelBefore.studying).toBe(true);
    const progressBefore = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM word_progress
      WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    const removed = await json("/studying", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeIds: ["travel"] }),
    });
    expect(removed.status).toBe(200);
    const after = await json("/themes");
    const travelAfter = after.body.themes.find((theme: { id: string }) => theme.id === "travel");
    expect(travelAfter.studying).toBe(false);
    expect(travelAfter.knownCount).toBe(travelBefore.knownCount);
    const progressAfter = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM word_progress
      WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(progressAfter[0]?.n).toBe(progressBefore[0]?.n);
  });

  it("enrolls a catalog theme into studying without starting a session", async () => {
    await json("/studying", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeIds: ["food"] }),
    });
    const enrolled = await json("/studying", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeIds: ["food"] }),
    });
    expect(enrolled.status).toBe(200);
    const listed = await json("/themes");
    expect(listed.body.themes.find((theme: { id: string }) => theme.id === "food").studying).toBe(true);
  });

  it("filters a travel session by CEFR level", async () => {
    const { status, body } = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "travel", mode: "learn", level: "A1" }),
    });
    expect(status).toBe(200);
    expect(body.level).toBe("A1");
    expect(body.words.length).toBeGreaterThan(0);
    expect(body.words.every((word: { level: string }) => word.level === "A1")).toBe(true);
  });

  it("blocks paid theme sessions without subscription", async () => {
    const { status, body } = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "health", mode: "learn" }),
    });
    expect(status).toBe(403);
    expect(body.code).toBe("subscription_required");
  });

  it("upserts progress and updates known count", async () => {
    const first = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { wordId: "airport", themeId: "travel", correct: 2, wrong: 0, known: true },
          { wordId: "ticket", themeId: "travel", correct: 1, wrong: 1, known: false },
        ],
      }),
    });
    expect(first.status).toBe(200);

    const second = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "airport", themeId: "travel", correct: 1, wrong: 0, known: false }],
      }),
    });
    expect(second.status).toBe(200);

    const themes = await json("/themes");
    expect(themes.body.themes[0].knownCount).toBe(1);

    const rows = await sql<{ correct_count: number; status: string }[]>`
      SELECT correct_count, status FROM word_progress
      WHERE word_id = 'airport'
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(rows[0].status).toBe("known");
    expect(rows[0].correct_count).toBe(3);
  });

  it("marks already-known words via progress upsert without mode scores", async () => {
    const before = await json("/themes");
    const knownBefore = before.body.themes[0].knownCount as number;

    const marked = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { wordId: "hotel", themeId: "travel", correct: 0, wrong: 0, known: true },
          { wordId: "flight", themeId: "travel", correct: 0, wrong: 0, known: true },
        ],
      }),
    });
    expect(marked.status).toBe(200);
    expect(marked.body.updated).toBe(2);

    const rows = await sql<{ word_id: string; status: string; correct_count: number }[]>`
      SELECT word_id, status, correct_count FROM word_progress
      WHERE word_id IN ('hotel', 'flight')
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
      ORDER BY word_id
    `;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "known")).toBe(true);
    expect(rows.every((row) => row.correct_count === 0)).toBe(true);

    const themes = await json("/themes");
    expect(themes.body.themes[0].knownCount).toBe(knownBefore + 2);
  });

  it("lists theme words with known flags and allows clearing known from the list", async () => {
    const listBefore = await json("/themes/travel/words");
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.themeId).toBe("travel");
    expect(Array.isArray(listBefore.body.words)).toBe(true);
    expect(listBefore.body.words.length).toBeGreaterThan(10);

    await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "hotel", themeId: "travel", correct: 0, wrong: 0, known: true }],
      }),
    });

    const listed = await json("/themes/travel/words");
    const hotel = listed.body.words.find((word: { id: string }) => word.id === "hotel");
    expect(hotel?.known).toBe(true);
    const listedWords = listed.body.words as { id: string; word?: string; en: string; known: boolean }[];
    const byHead = (items: typeof listedWords) =>
      [...items].sort(
        (a, b) =>
          (a.word || a.en).localeCompare(b.word || b.en, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id),
      );
    expect(listedWords.map((word) => word.id)).toEqual(byHead(listedWords).map((word) => word.id));

    const cleared = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "hotel", themeId: "travel", correct: 0, wrong: 0, known: false }],
      }),
    });
    expect(cleared.status).toBe(200);

    const after = await json("/themes/travel/words");
    const hotelAfter = after.body.words.find((word: { id: string }) => word.id === "hotel");
    expect(hotelAfter?.known).toBe(false);

    const a1 = await json("/themes/travel/words?level=A1");
    expect(a1.status).toBe(200);
    expect(a1.body.level).toBe("A1");
    expect(a1.body.words.every((word: { level: string }) => word.level === "A1")).toBe(true);
  });

  it("accepts a legacy prefixed id and stores the canonical slug", async () => {
    const marked = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "travel.passport", correct: 0, wrong: 0, known: true }],
      }),
    });
    expect(marked.status).toBe(200);
    expect(marked.body.updated).toBe(1);

    const rows = await sql<{ word_id: string; theme_id: string | null }[]>`
      SELECT word_id, theme_id FROM word_progress
      WHERE word_id IN ('passport', 'travel.passport')
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].word_id).toBe("passport");
    expect(rows[0].theme_id).toBeNull();
  });

  it("counts a shared word once and skips it in the other theme session", async () => {
    const overlap = overlappingWord();
    expect(overlap.themeIds.length).toBeGreaterThanOrEqual(2);
    const copies = overlap.themeIds.map((id) => dictionary.getTheme(id)?.words.find((word) => word.id === overlap.wordId));
    expect(new Set(copies.map((word) => word?.en)).size).toBe(1);
    expect(new Set(copies.map((word) => JSON.stringify(word?.ru))).size).toBe(1);

    const firstTheme = overlap.themeIds.includes("travel") ? "travel" : overlap.themeIds[0];
    const secondTheme = overlap.themeIds.find((id) => id !== firstTheme)!;

    await sql`
      INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at)
      SELECT id, 9001001, 'monthly', 'regular', now() + interval '1 year'
      FROM users WHERE telegram_user_id = ${telegramUserId}
      ON CONFLICT (tribute_subscription_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, cancelled_at = NULL
    `;

    const before = await json("/themes");
    const knownBefore = new Map(
      (before.body.themes as { id: string; knownCount: number }[]).map((theme) => [theme.id, theme.knownCount]),
    );

    const marked = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: overlap.wordId, themeId: firstTheme, correct: 0, wrong: 0, known: true }],
      }),
    });
    expect(marked.status).toBe(200);

    const after = await json("/themes");
    const knownAfter = new Map(
      (after.body.themes as { id: string; knownCount: number }[]).map((theme) => [theme.id, theme.knownCount]),
    );
    expect(knownAfter.get(firstTheme)).toBe((knownBefore.get(firstTheme) ?? 0) + 1);
    expect(knownAfter.get(secondTheme)).toBe((knownBefore.get(secondTheme) ?? 0) + 1);

    const progressRows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM word_progress
      WHERE word_id = ${overlap.wordId}
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(progressRows[0].count).toBe(1);

    const session = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: secondTheme, mode: "learn" }),
    });
    expect(session.status).toBe(200);
    expect(session.body.words.some((word: { id: string }) => word.id === overlap.wordId)).toBe(false);
  });
});

describe("teachers feed", () => {
  it("opens for a free user and does not subscribe them", async () => {
    await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;

    const open = await json("/teachers");
    expect(open.status).toBe(200);
    expect(Array.isArray(open.body.teachers)).toBe(true);
    expect(open.body.admin).toBe(false);

    const themes = await json("/themes");
    expect(themes.body.subscribed).toBe(false);
    expect(themes.body.listedTeacher).toBe(false);
    expect(themes.body.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(true);
    const rows = await sql`
      SELECT id FROM subscriptions
      WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(rows).toHaveLength(0);
  });

  it("lets @YOUR_SUPPORT_USERNAME add and remove a teacher, and rejects everyone else", async () => {
    await sql`DELETE FROM teachers WHERE telegram_username ILIKE 'moti_test_%'`;
    const denied = await json("/teachers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Тест", telegramUsername: "moti_test_tutor" }),
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("forbidden");

    if (config.botToken.includes("replace-me")) return;

    const headers = {
      Authorization: `tma ${makeInitData(botToken, 9_001_777, "Ilia", undefined, "YOUR_SUPPORT_USERNAME")}`,
      "Content-Type": "application/json",
    };
    await app.request("/me", { headers });
    await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = 9001777`;
    const openPhoto = await app.request("/teachers/missing-photo/photo");
    expect(openPhoto.status).toBe(404);
    setTelegramTeacherLookup(async () => ({
      telegramUserId: 42,
      photoFileId: "file-test",
      warning: null,
    }));
    const created = await app.request("/teachers", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Анна Тест",
        telegramUsername: "@moti_test_tutor",
        bio: "Разговорный английский",
      }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    expect(createdBody.teacher.telegramUsername).toBe("moti_test_tutor");
    expect(createdBody.teacher.bio).toBe("Разговорный английский");
    expect(createdBody.teacher.photoUrl).toBe(`/teachers/${createdBody.teacher.id}/photo`);
    expect(createdBody.warning).toBeNull();
    const storedLang = await sql<{ language: string }[]>`
      SELECT language FROM teachers WHERE id = ${createdBody.teacher.id}
    `;
    expect(storedLang[0]?.language).toBe("en");

    const teacherHeaders = {
      Authorization: `tma ${makeInitData(botToken, 9_001_778, "Анна", undefined, "Moti_Test_Tutor")}`,
    };
    await app.request("/me", { headers: teacherHeaders });
    await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = 9001778`;
    const asTeacher = await app.request("/teachers", { headers: teacherHeaders });
    const asTeacherBody = await asTeacher.json();
    expect(asTeacher.status).toBe(200);
    expect(asTeacherBody.admin).toBe(false);
    expect(asTeacherBody.teachers.some((teacher: { id: string }) => teacher.id === createdBody.teacher.id)).toBe(true);
    const teacherThemes = await app.request("/themes", { headers: teacherHeaders });
    const teacherThemesBody = await teacherThemes.json();
    expect(teacherThemes.status).toBe(200);
    expect(teacherThemesBody.subscribed).toBe(true);
    expect(teacherThemesBody.listedTeacher).toBe(true);
    const teacherSub = await sql`
      SELECT id FROM subscriptions
      WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = 9001778)
    `;
    expect(teacherSub).toHaveLength(0);
    const teacherWrite = await app.request("/teachers", {
      method: "POST",
      headers: { ...teacherHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Чужой", telegramUsername: "moti_test_other" }),
    });
    expect(teacherWrite.status).toBe(403);

    const listed = await app.request("/teachers", { headers });
    const listedBody = await listed.json();
    expect(listed.status).toBe(200);
    expect(listedBody.admin).toBe(true);
    expect(listedBody.teachers.some((teacher: { id: string }) => teacher.id === createdBody.teacher.id)).toBe(true);

    const duplicate = await app.request("/teachers", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Ещё", telegramUsername: "moti_test_tutor" }),
    });
    expect(duplicate.status).toBe(409);

    setTelegramTeacherLookup(async () => ({
      telegramUserId: null,
      photoFileId: null,
      warning: "нет фото",
    }));
    const kept = await app.request(`/teachers/${createdBody.teacher.id}/photo`, { method: "POST", headers });
    const keptBody = await kept.json();
    expect(kept.status).toBe(200);
    expect(keptBody.warning).toBe("нет фото");
    expect(keptBody.teacher.photoUrl).toBe(`/teachers/${createdBody.teacher.id}/photo`);

    setTelegramTeacherLookup(async () => ({
      telegramUserId: 42,
      photoFileId: "file-test-2",
      warning: null,
    }));
    const refreshed = await app.request(`/teachers/${createdBody.teacher.id}/photo`, { method: "POST", headers });
    const refreshedBody = await refreshed.json();
    expect(refreshed.status).toBe(200);
    expect(refreshedBody.warning).toBeNull();
    expect(refreshedBody.teacher.photoUrl).toBe(`/teachers/${createdBody.teacher.id}/photo`);

    const removed = await app.request(`/teachers/${createdBody.teacher.id}`, { method: "DELETE", headers });
    expect(removed.status).toBe(200);
    const after = await app.request("/teachers", { headers });
    const afterBody = await after.json();
    expect(afterBody.teachers.some((teacher: { id: string }) => teacher.id === createdBody.teacher.id)).toBe(false);
    await sql`DELETE FROM teachers WHERE telegram_username ILIKE 'moti_test_%'`;
    setTelegramTeacherLookup(null);
  });

  it("treats a listed teacher as subscribed until they leave the list", async () => {
    const teacherTg = 9_001_779;
    await sql`DELETE FROM teachers WHERE id = 'moti-access-en' OR telegram_username ILIKE 'moti_test_access_%'`;
    await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${teacherTg})`;
    await sql`DELETE FROM user_free_media WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${teacherTg})`;
    if (config.botToken.includes("replace-me")) return;

    const headers = {
      Authorization: `tma ${makeInitData(botToken, teacherTg, "Марк", undefined, "moti_test_access_tutor")}`,
    };
    try {
      await app.request("/me", { headers });
      await sql`
        UPDATE users SET language = 'en', free_media_id = NULL
        WHERE telegram_user_id = ${teacherTg}
      `;

      const before = await app.request("/themes", { headers });
      const beforeBody = await before.json();
      expect(beforeBody.subscribed).toBe(false);
      expect(beforeBody.listedTeacher).toBe(false);
      expect(beforeBody.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(true);

      await sql`
        INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, language)
        VALUES ('moti-access-en', 'Марк', 'moti_test_access_tutor', ${teacherTg}, 'английский', 'en')
      `;

      const open = await app.request("/themes", { headers });
      const openBody = await open.json();
      expect(open.status).toBe(200);
      expect(openBody.subscribed).toBe(true);
      expect(openBody.listedTeacher).toBe(true);
      expect(openBody.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(false);
      const noRow = await sql`
        SELECT id FROM subscriptions
        WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${teacherTg})
      `;
      expect(noRow).toHaveLength(0);

      const session = await app.request("/sessions", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "health", mode: "learn" }),
      });
      expect(session.status).toBe(200);

      const film = (openBody.themes as { id: string; kind?: string; wordCount: number }[]).find(
        (theme) => (theme.kind === "movie" || theme.kind === "episode") && theme.wordCount > 0,
      );
      expect(film).toBeTruthy();
      const mediaSession = await app.request("/sessions", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: film?.id, mode: "learn" }),
      });
      expect(mediaSession.status).toBe(200);
      const mediaPick = await sql<{ free_media_id: string | null }[]>`
        SELECT free_media_id FROM users WHERE telegram_user_id = ${teacherTg}
      `;
      expect(mediaPick[0]?.free_media_id ?? null).toBeNull();
      const mediaRows = await sql`
        SELECT free_media_id FROM user_free_media
        WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${teacherTg})
      `;
      expect(mediaRows).toHaveLength(0);

      const texts = await app.request("/texts", { headers });
      const textsBody = await texts.json();
      expect(texts.status).toBe(200);
      expect(textsBody.quota.maxTexts).toBeGreaterThan(1);
      expect(textsBody.quota.maxChars).toBeGreaterThan(2000);

      seedFrenchCatalog();
      const frenchNumbers = getDictionary("fr").getTheme("numbers");
      expect(frenchNumbers).toBeTruthy();
      frenchNumbers!.paid = true;
      await sql`UPDATE users SET language = 'fr' WHERE telegram_user_id = ${teacherTg}`;
      const french = await app.request("/themes", { headers });
      const frenchBody = await french.json();
      expect(frenchBody.subscribed).toBe(false);
      expect(frenchBody.listedTeacher).toBe(false);
      expect(frenchBody.themes.find((theme: { id: string }) => theme.id === "numbers").locked).toBe(true);
      const frenchSession = await app.request("/sessions", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "numbers", mode: "learn" }),
      });
      expect(frenchSession.status).toBe(403);

      await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = ${teacherTg}`;
      const back = await app.request("/themes", { headers });
      const backBody = await back.json();
      expect(backBody.subscribed).toBe(true);
      expect(backBody.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(false);

      await sql`DELETE FROM teachers WHERE id = 'moti-access-en'`;
      const removed = await app.request("/themes", { headers });
      const removedBody = await removed.json();
      expect(removedBody.subscribed).toBe(false);
      expect(removedBody.listedTeacher).toBe(false);
      expect(removedBody.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(true);

      await sql`
        INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at)
        SELECT id, 9001779, 'monthly', 'regular', now() + interval '1 day'
        FROM users WHERE telegram_user_id = ${teacherTg}
        ON CONFLICT (tribute_subscription_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, cancelled_at = NULL
      `;
      const paying = await app.request("/themes", { headers });
      const payingBody = await paying.json();
      expect(payingBody.subscribed).toBe(true);
      expect(payingBody.listedTeacher).toBe(false);
      expect(payingBody.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(false);
    } finally {
      await sql`DELETE FROM teachers WHERE id = 'moti-access-en' OR telegram_username ILIKE 'moti_test_access_%'`;
      await sql`DELETE FROM subscriptions WHERE tribute_subscription_id = 9001779`;
      await sql`DELETE FROM user_free_media WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${teacherTg})`;
      await sql`UPDATE users SET language = 'en', free_media_id = NULL WHERE telegram_user_id = ${teacherTg}`;
      clearFrenchCatalog();
    }
  });

  it("scopes teachers to the signed-in user's learning language", async () => {
    await sql`DELETE FROM teachers WHERE id LIKE 'moti-lang-%' OR telegram_username ILIKE 'moti_test_lang_%'`;
    const admin: AppUser = {
      id: "0",
      telegramUserId: 9_001_777,
      telegramUsername: "YOUR_SUPPORT_USERNAME",
      subscribed: true,
      freeMediaId: null,
      dev: false,
      onboardingDone: true,
      language: "en",
      languageChosen: true,
    };
    try {
      await sql`
        INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, language)
        VALUES ('moti-lang-en', 'Анна', 'moti_test_lang_tutor', 9001778, 'английский', 'en')
      `;
      expect((await listTeachers("en")).some((teacher) => teacher.id === "moti-lang-en")).toBe(true);
      expect((await listTeachers("fr")).some((teacher) => teacher.id === "moti-lang-en")).toBe(false);

      const teacherUser = {
        telegramUserId: 9_001_778,
        telegramUsername: "moti_test_lang_tutor",
        language: "fr",
      };
      expect(await isListedTeacher({ ...teacherUser, language: "en" })).toBe(true);
      expect(await isListedTeacher(teacherUser)).toBe(false);

      setTelegramTeacherLookup(async () => ({ telegramUserId: 9_001_778, photoFileId: null, warning: null }));
      const body = { name: "Анна", telegramUsername: "moti_test_lang_tutor", language: "en" };
      const added = await insertTeacher({ ...admin, language: "fr" }, body);
      expect(added.teacher.id).not.toBe("moti-lang-en");
      const stored = await sql<{ language: string }[]>`
        SELECT language FROM teachers WHERE id = ${added.teacher.id}
      `;
      expect(stored[0]?.language).toBe("fr");
      expect((await listTeachers("en")).some((teacher) => teacher.id === added.teacher.id)).toBe(false);
      expect((await listTeachers("fr")).some((teacher) => teacher.id === added.teacher.id)).toBe(true);
      expect((await listTeachers("fr")).some((teacher) => teacher.id === "moti-lang-en")).toBe(false);

      await expect(
        insertTeacher({ ...admin, language: "fr" }, { name: "Ещё", telegramUsername: "moti_test_lang_tutor" }),
      ).rejects.toMatchObject({ status: 409, code: "teacher_exists" });
      await expect(removeTeacherRow({ ...admin, language: "fr" }, "moti-lang-en")).rejects.toMatchObject({ status: 404 });
      expect(await sql`SELECT id FROM teachers WHERE id = 'moti-lang-en'`).toHaveLength(1);
      await removeTeacherRow(admin, "moti-lang-en");
      expect(await sql`SELECT id FROM teachers WHERE id = 'moti-lang-en'`).toHaveLength(0);

      if (!config.botToken.includes("replace-me")) {
        const headers = {
          Authorization: `tma ${makeInitData(botToken, 9_001_777, "Ilia", undefined, "YOUR_SUPPORT_USERNAME")}`,
        };
        await app.request("/me", { headers });
        const before = await sql<{ language: string; language_chosen: boolean }[]>`
          SELECT language, language_chosen FROM users WHERE telegram_user_id = 9001777
        `;
        await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = 9001777`;
        const spoof = await app.request("/teachers?language=fr", { headers });
        const spoofBody = await spoof.json();
        expect(spoof.status).toBe(200);
        expect(spoofBody.teachers.some((teacher: { id: string }) => teacher.id === added.teacher.id)).toBe(false);
        await sql`UPDATE users SET language = 'fr' WHERE telegram_user_id = 9001777`;
        const asFrench = await app.request("/teachers?language=en", { headers });
        const asFrenchBody = await asFrench.json();
        expect(asFrench.status).toBe(200);
        expect(asFrenchBody.teachers.some((teacher: { id: string }) => teacher.id === added.teacher.id)).toBe(true);
        expect(asFrenchBody.teachers.some((teacher: { id: string }) => teacher.id === "moti-lang-en")).toBe(false);
        await sql`
          UPDATE users
          SET language = ${before[0]?.language ?? "en"}, language_chosen = ${before[0]?.language_chosen ?? false}
          WHERE telegram_user_id = 9001777
        `;
      }
    } finally {
      setTelegramTeacherLookup(null);
      await sql`DELETE FROM teachers WHERE id LIKE 'moti-lang-%' OR telegram_username ILIKE 'moti_test_lang_%'`;
    }
  });

  it("sends a teacher application to support without listing the applicant", async () => {
    const applicantId = 9_001_780;
    const headersFor = (photoUrl?: string) => ({
      Authorization: `tma ${makeInitData(botToken, applicantId, "Ilia", undefined, "moti_test_apply", photoUrl)}`,
      "Content-Type": "application/json",
    });
    const headers = headersFor();
    const messages: string[] = [];
    let avatarCalls = 0;
    setTeacherApplicationNotifier(async (notice) => {
      messages.push(notice.text);
    });
    setTeacherAvatarLookup(async () => {
      avatarCalls += 1;
      return null;
    });
    const apply = (body: unknown, photoUrl?: string) =>
      app.request("/teachers/apply", {
        method: "POST",
        headers: photoUrl ? headersFor(photoUrl) : headers,
        body: JSON.stringify(body),
      });
    try {
      const opened = await app.request("/teachers", { headers });
      const openedBody = (await opened.json()) as {
        listed?: boolean;
        teachLanguages?: { code: string; title: string }[];
        account?: { telegramUserId: number; telegramUsername: string | null };
      };
      expect(opened.status).toBe(200);
      expect(openedBody.listed).toBe(false);
      expect(openedBody.teachLanguages?.map((item) => `${item.code}:${item.title}`)).toEqual(
        namedLanguages().map((item) => `${item.code}:${item.title}`),
      );
      expect(openedBody.teachLanguages?.map((item) => item.title)).toEqual([
        "Английский",
        "Французский",
        "Немецкий",
        "Испанский",
        "Итальянский",
        "Португальский",
        "Финский",
        "Словенский",
        "Хорватский",
        "Сербский",
      ]);
      expect(openedBody.account?.telegramUserId).toBe(applicantId);
      expect(openedBody.account?.telegramUsername).toBe("moti_test_apply");

      expect((await apply({ name: "Мария", bio: "текст", languages: [] })).status).toBe(400);
      expect((await apply({ name: "Мария", bio: "", languages: ["en"] })).status).toBe(400);
      expect((await apply({ name: "Мария", bio: "я".repeat(201), languages: ["en"] })).status).toBe(400);
      expect((await apply({ name: "Мария", bio: "текст", languages: ["xx"] })).status).toBe(400);
      expect(messages).toHaveLength(0);
      expect(avatarCalls).toBe(0);

      const sent = await apply({ name: "Мария", bio: "Разговорный английский", languages: ["en", "de"] });
      expect(sent.status).toBe(200);
      const text = messages[0] ?? "";
      expect(text).toContain("Имя: Мария");
      expect(text).toContain("Telegram: @moti_test_apply");
      expect(text).toContain(`Telegram id: ${applicantId}`);
      expect(text).toContain("О себе: Разговорный английский");
      expect(text).toContain("Фото: аватарки нет");
      expect(text).toContain("🇬🇧 Английский");
      expect(text).toContain("🇩🇪 Немецкий");
      expect(text).not.toContain("🇫🇷");
      expect(avatarCalls).toBe(1);

      const rows = await sql<{ id: string }[]>`
        SELECT id FROM teachers
        WHERE telegram_user_id = ${applicantId} OR lower(telegram_username) = 'moti_test_apply'
      `;
      expect(rows).toHaveLength(0);
      const themes = await app.request("/themes", { headers });
      const themesBody = await themes.json();
      expect(themesBody.subscribed).toBe(false);
      expect(themesBody.listedTeacher).toBe(false);

      const withPhoto = await apply(
        { name: "Мария", bio: "С фото", languages: ["fr"] },
        "https://t.me/i/userpic/320/moti.jpg",
      );
      expect(withPhoto.status).toBe(200);
      expect(messages.at(-1)).toContain("Фото: photo_url https://t.me/i/userpic/320/moti.jpg");
      expect(messages.at(-1)).toContain("🇫🇷 Французский");
      expect(avatarCalls).toBe(1);

      setTeacherAvatarLookup(async () => {
        avatarCalls += 1;
        return "AgAC_test_avatar";
      });
      const withFile = await apply({ name: "Мария", bio: "Файл", languages: ["es"] });
      expect(withFile.status).toBe(200);
      expect(messages.at(-1)).toContain("Фото: photo_file_id AgAC_test_avatar");
      expect(messages.at(-1)).toContain("🇪🇸 Испанский");

      let failures = 0;
      setTeacherApplicationNotifier(async () => {
        failures += 1;
        throw new Error("telegram rejected");
      });
      const failed = await apply({ name: "Мария", bio: "ещё раз", languages: ["en"] });
      const failedBody = (await failed.json()) as { error?: string };
      expect(failed.status).toBe(502);
      expect(failedBody.error).toContain("поддержк");
      const failedAgain = await apply({ name: "Мария", bio: "ещё раз", languages: ["en"] });
      expect(failedAgain.status).toBe(502);
      expect(failures).toBe(2);

      setTeacherApplicationNotifier(async (notice) => {
        messages.push(notice.text);
      });
      await sql`
        INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, language)
        VALUES ('moti-apply-en', 'Listed', 'moti_test_apply', ${applicantId}, '', 'en')
      `;
      const ownFeed = await app.request("/teachers", { headers });
      const ownBody = (await ownFeed.json()) as { listed?: boolean };
      expect(ownBody.listed).toBe(false);
      const before = messages.length;
      const stillOpen = await apply({ name: "Мария", bio: "ещё французский", languages: ["fr"] });
      expect(stillOpen.status).toBe(200);
      expect(messages).toHaveLength(before + 1);

      for (const language of namedLanguages()) {
        if (language.code === "en") continue;
        await sql`
          INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, language)
          VALUES (${`moti-apply-${language.code}`}, 'Listed', 'moti_test_apply', ${applicantId}, '', ${language.code})
        `;
      }
      const closed = await app.request("/teachers", { headers });
      const closedBody = (await closed.json()) as { listed?: boolean };
      expect(closedBody.listed).toBe(true);
      const blocked = await apply({ name: "Мария", bio: "нет", languages: ["de"] });
      expect(blocked.status).toBe(409);
      expect(messages).toHaveLength(before + 1);
    } finally {
      setTeacherApplicationNotifier(null);
      setTeacherAvatarLookup(null);
      await sql`DELETE FROM teachers WHERE id LIKE 'moti-apply-%' OR lower(telegram_username) = 'moti_test_apply'`;
      await sql`DELETE FROM teacher_applications WHERE telegram_user_id = ${applicantId}`;
      await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = ${applicantId}`;
    }
  });

  it("approves a teacher application into the feed and can reject the next one", async () => {
    const applicantId = 9_001_781;
    const headers = {
      Authorization: `tma ${makeInitData(botToken, applicantId, "Ilia", undefined, "moti_test_decide")}`,
      "Content-Type": "application/json",
    };
    let notice: { id: string; text: string } | null = null;
    setTeacherApplicationNotifier(async (item) => {
      notice = item;
    });
    setTeacherAvatarLookup(async () => null);
    try {
      const sent = await app.request("/teachers/apply", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Мария", bio: "Разговорный", languages: ["en", "de"] }),
      });
      expect(sent.status).toBe(200);
      expect(notice).not.toBeNull();
      const parsed = parseTeacherApplicationMessage(notice?.text ?? "");
      expect(parsed?.telegramUserId).toBe(applicantId);
      expect(parsed?.languages.map((item) => item.code)).toEqual(["en", "de"]);

      const approved = await approveTeacherApplication(notice?.id ?? "");
      expect(approved.userMessage).toContain("Вас добавили в ленту");
      expect(approved.userMessage).toContain("Английский");
      expect(approved.userMessage).toContain("Немецкий");
      expect(approved.summary).toContain("Одобрено");
      const rows = await sql<{ language: string }[]>`
        SELECT language FROM teachers
        WHERE telegram_user_id = ${applicantId}
        ORDER BY language
      `;
      expect(rows.map((row) => row.language)).toEqual(["de", "en"]);
      await expect(approveTeacherApplication(notice?.id ?? "")).rejects.toThrow("уже разобрана");

      const again = await acceptTeacherApplication(parsed!);
      expect(again.userMessage).toBeNull();
      expect(again.summary).toContain("Уже в ленте");

      notice = null;
      const second = await app.request("/teachers/apply", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Мария", bio: "Ещё язык", languages: ["fr"] }),
      });
      expect(second.status).toBe(200);
      const rejected = await rejectTeacherApplication(notice?.id ?? "");
      expect(rejected.summary).toBe("Отклонено.");
      expect(rejected.userMessage).toContain("не одобрили");
      expect(rejected.telegramUserId).toBe(applicantId);
      const french = await sql<{ id: string }[]>`
        SELECT id FROM teachers WHERE telegram_user_id = ${applicantId} AND language = 'fr'
      `;
      expect(french).toHaveLength(0);
      await expect(rejectTeacherApplication(notice?.id ?? "")).rejects.toThrow("уже разобрана");
    } finally {
      setTeacherApplicationNotifier(null);
      setTeacherAvatarLookup(null);
      await sql`DELETE FROM teachers WHERE lower(telegram_username) = 'moti_test_decide'`;
      await sql`DELETE FROM teacher_applications WHERE telegram_user_id = ${applicantId}`;
      await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = ${applicantId}`;
    }
  });

  it("lets a teacher remove their own profile from every language", async () => {
    const teacherTg = 9_001_782;
    const otherTg = 9_001_783;
    await sql`DELETE FROM teachers WHERE telegram_username ILIKE 'moti_test_leave_%'`;
    const headers = {
      Authorization: `tma ${makeInitData(botToken, teacherTg, "Марк", undefined, "moti_test_leave_tutor")}`,
    };
    const stranger = {
      Authorization: `tma ${makeInitData(botToken, otherTg, "Анна", undefined, "moti_test_leave_other")}`,
    };
    try {
      await app.request("/me", { headers });
      await sql`
        INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, language)
        VALUES
          ('moti-leave-en', 'Марк', 'moti_test_leave_tutor', ${teacherTg}, 'английский', 'en'),
          ('moti-leave-de', 'Марк', 'moti_test_leave_tutor', ${teacherTg}, 'немецкий', 'de'),
          ('moti-leave-other', 'Анна', 'moti_test_leave_other', ${otherTg}, 'рядом', 'en')
      `;
      const opened = await app.request("/teachers", { headers });
      const openedBody = (await opened.json()) as { ownProfile?: boolean };
      expect(openedBody.ownProfile).toBe(true);
      const denied = await app.request("/teachers/moti-leave-en", { method: "DELETE", headers });
      expect(denied.status).toBe(403);
      const gone = await app.request("/teachers/me", { method: "DELETE", headers });
      expect(gone.status).toBe(200);
      const left = await sql<{ id: string }[]>`
        SELECT id FROM teachers WHERE telegram_username ILIKE 'moti_test_leave_%' ORDER BY id
      `;
      expect(left.map((row) => row.id)).toEqual(["moti-leave-other"]);
      const again = await app.request("/teachers/me", { method: "DELETE", headers });
      expect(again.status).toBe(404);
      const after = await app.request("/teachers", { headers });
      const afterBody = (await after.json()) as { ownProfile?: boolean };
      expect(afterBody.ownProfile).toBe(false);
      const strangerFeed = await app.request("/teachers", { headers: stranger });
      const strangerBody = (await strangerFeed.json()) as { ownProfile?: boolean };
      expect(strangerBody.ownProfile).toBe(true);
    } finally {
      await sql`DELETE FROM teachers WHERE telegram_username ILIKE 'moti_test_leave_%'`;
      await sql`UPDATE users SET language = 'en' WHERE telegram_user_id IN (${teacherTg}, ${otherTg})`;
    }
  });
});

describe("tribute webhook", () => {
  const purchaseId = 4242;

  function digitalEvent(name: string, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      name,
      created_at: extra.created_at ?? "2026-10-08T08:00:00.000Z",
      sent_at: extra.sent_at ?? `2026-10-08T08:00:01.${telegramUserId}Z`,
      payload: {
        product_id: config.tributeProductMonthlyId,
        purchase_id: purchaseId,
        amount: 49900,
        currency: "rub",
        telegram_user_id: telegramUserId,
        ...extra,
      },
    });
  }

  it("rejects a bad signature", async () => {
    const body = digitalEvent("new_digital_product");
    const response = await app.request("/webhook/tribute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "trbt-signature": "nope" },
      body,
    });
    expect(response.status).toBe(401);
  });

  it("grants access from a digital product purchase, is idempotent, and revokes on refund", async () => {
    await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    const body = digitalEvent("new_digital_product");
    const headers = {
      "Content-Type": "application/json",
      "trbt-signature": signTributeBody(body),
    };
    const first = await app.request("/webhook/tribute", { method: "POST", headers, body });
    const firstJson = (await first.json()) as { ok: boolean; duplicate?: boolean };
    expect(first.status).toBe(200);
    expect(firstJson.ok).toBe(true);

    const replay = await app.request("/webhook/tribute", { method: "POST", headers, body });
    const replayJson = (await replay.json()) as { duplicate?: boolean };
    expect(replay.status).toBe(200);
    expect(replayJson.duplicate).toBe(true);

    const themes = await json("/themes");
    expect(themes.body.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(false);
    expect(themes.body.subscribeUrl).toMatch(/^https:\/\//);
    expect(themes.body.subscribeYearlyUrl).toMatch(/^https:\/\//);

    const rows = await sql<{ period: string; expires_at: Date }[]>`
      SELECT period, expires_at FROM subscriptions
      WHERE tribute_subscription_id = ${purchaseId}
    `;
    expect(rows[0].period).toBe("monthly");
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(Date.now() + 20 * 24 * 60 * 60 * 1000);

    const refundBody = digitalEvent("digital_product_refund");
    const refund = await app.request("/webhook/tribute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "trbt-signature": signTributeBody(refundBody),
      },
      body: refundBody,
    });
    expect(refund.status).toBe(200);

    const afterRefund = await json("/themes");
    expect(afterRefund.body.themes.find((theme: { id: string }) => theme.id === "health").locked).toBe(true);

    const progress = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM word_progress
      WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(progress[0].count).toBeGreaterThan(0);
  });
});

describe("tamagotchi pet", () => {
  async function asPetUser<T>(telegramId: number, run: (call: typeof json) => Promise<T>): Promise<T> {
    const previousId = config.devTelegramUserId;
    const previousAuth = config.allowDevAuth;
    (config as { allowDevAuth: boolean }).allowDevAuth = true;
    (config as { devTelegramUserId: number }).devTelegramUserId = telegramId;
    const call: typeof json = async (path, init) => {
      const response = await app.request(path, {
        ...init,
        headers: {
          ...(config.botToken.includes("replace-me")
            ? { Authorization: "dev" }
            : { Authorization: `tma ${makeInitData(botToken, telegramId)}` }),
          ...(init?.headers ?? {}),
        },
      });
      const body = await response.json();
      return { status: response.status, body };
    };
    try {
      return await run(call);
    } finally {
      (config as { allowDevAuth: boolean }).allowDevAuth = previousAuth;
      (config as { devTelegramUserId: number }).devTelegramUserId = previousId;
      await sql`DELETE FROM pets WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM users WHERE telegram_user_id = ${telegramId}`;
    }
  }

  it("awards coins the first time a word becomes known and not again", async () => {
    await asPetUser(9_001_101, async (call) => {
      const first = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: "airport", themeId: "travel", correct: 0, wrong: 0, known: true }],
        }),
      });
      expect(first.status).toBe(200);
      expect(first.body.coinsEarned).toBe(PET.coinsPerKnownWord);
      expect(first.body.pet.coins).toBe(PET.startingCoins + PET.coinsPerKnownWord);
      expect(first.body.pet.status).toBe("alive");

      const again = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: "airport", themeId: "travel", correct: 1, wrong: 0, known: true }],
        }),
      });
      expect(again.status).toBe(200);
      expect(again.body.coinsEarned).toBe(0);
      expect(again.body.pet.coins).toBe(PET.startingCoins + PET.coinsPerKnownWord);
    });
  });

  it("marks a word known without coins when awardCoins is false", async () => {
    await asPetUser(9_001_110, async (call) => {
      const marked = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: "airport", themeId: "travel", correct: 0, wrong: 0, known: true, awardCoins: false }],
        }),
      });
      expect(marked.status).toBe(200);
      expect(marked.body.updated).toBe(1);
      expect(marked.body.coinsEarned).toBe(0);
      expect(marked.body.rescued).toBe(false);
      expect(marked.body.pet.coins).toBe(PET.startingCoins);

      const rows = await sql<{ status: string }[]>`
        SELECT status FROM word_progress
        WHERE word_id = 'airport'
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = 9001110)
      `;
      expect(rows[0]?.status).toBe("known");
    });
  });

  it("sends a missed exam word back to study without paying again", async () => {
    await asPetUser(9_001_111, async (call) => {
      const first = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: "airport", themeId: "travel", correct: 2, wrong: 0, known: true }],
        }),
      });
      expect(first.status).toBe(200);
      expect(first.body.coinsEarned).toBe(PET.coinsPerKnownWord);

      const missed = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: "airport", themeId: "exam", correct: 1, wrong: 1, known: false, awardCoins: false, demote: true }],
        }),
      });
      expect(missed.status).toBe(200);
      expect(missed.body.coinsEarned).toBe(0);

      const rows = await sql<{ status: string; rewarded: boolean }[]>`
        SELECT status, rewarded FROM word_progress
        WHERE word_id = 'airport'
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = 9001111)
      `;
      expect(rows[0]?.status).toBe("learning");
      expect(rows[0]?.rewarded).toBe(true);

      const again = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: "airport", themeId: "travel", correct: 2, wrong: 0, known: true }],
        }),
      });
      expect(again.status).toBe(200);
      expect(again.body.coinsEarned).toBe(0);
      expect(again.body.pet.coins).toBe(PET.startingCoins + PET.coinsPerKnownWord);
    });
  });

  it("builds an exam from known words on unfinished studying themes", async () => {
    await asPetUser(9_001_112, async (call) => {
      const idle = await call("/exam", { method: "POST" });
      expect(idle.status).toBe(400);
      expect(idle.body.code).toBe("empty_exam");

      const marked = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { wordId: "airport", themeId: "travel", correct: 0, wrong: 0, known: true, awardCoins: false },
            { wordId: "hotel", themeId: "travel", correct: 0, wrong: 0, known: true, awardCoins: false },
          ],
        }),
      });
      expect(marked.status).toBe(200);

      const exam = await call("/exam", { method: "POST" });
      expect(exam.status).toBe(200);
      expect(exam.body.words.map((word: { id: string }) => word.id).sort()).toEqual(["airport", "hotel"]);

      const travel = dictionary.getTheme("travel");
      expect(travel).toBeTruthy();
      const many = travel!.words.slice(0, 25);
      expect(many.length).toBe(25);
      const packed = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: many.map((word) => ({
            wordId: word.id,
            themeId: "travel",
            correct: 0,
            wrong: 0,
            known: true,
            awardCoins: false,
          })),
        }),
      });
      expect(packed.status).toBe(200);
      const capped = await call("/exam", { method: "POST" });
      expect(capped.status).toBe(200);
      expect(capped.body.words).toHaveLength(20);
      const allowed = new Set(many.map((word) => word.id));
      expect(capped.body.words.every((word: { id: string }) => allowed.has(word.id))).toBe(true);
    });
  });

  it("skips a theme once every word in it is known", async () => {
    await asPetUser(9_001_113, async (call) => {
      const theme = FREE_THEME_IDS.map((id) => dictionary.getTheme(id)).find((item) => item && item.words.length > 0);
      expect(theme).toBeTruthy();
      const saved = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: theme!.words.map((word) => ({
            wordId: word.id,
            themeId: theme!.id,
            correct: 0,
            wrong: 0,
            known: true,
            awardCoins: false,
          })),
        }),
      });
      expect(saved.status).toBe(200);
      const exam = await call("/exam", { method: "POST" });
      expect(exam.status).toBe(400);
      expect(exam.body.code).toBe("empty_exam");
    });
  });

  it("ticks to suffering with no coins, then cryo after the threshold", async () => {
    await asPetUser(9_001_102, async (call) => {
      const created = await call("/pet");
      expect(created.status).toBe(200);
      expect(created.body.pet.status).toBe("alive");
      expect(created.body.pet.coins).toBe(PET.startingCoins);
      expect(created.body.pet.hunger).toBe(PET.startingHunger);
      expect(created.body.pet.mood).toBe(PET.startingMood);

      await sql`
        UPDATE pets
        SET coins = 0, hunger = 0, mood = 0, status = 'alive', last_tick_at = now() - interval '2 hours',
            suffering_started_at = NULL, cryo_at = NULL
        WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 9001102)
      `;
      const hurting = await call("/pet");
      expect(hurting.status).toBe(200);
      expect(hurting.body.pet.status).toBe("suffering");
      expect(hurting.body.pet.coins).toBe(0);

      await sql`
        UPDATE pets
        SET status = 'suffering', coins = 0,
            suffering_started_at = now() - interval '73 hours',
            last_tick_at = now() - interval '1 hour'
        WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 9001102)
      `;
      const frozen = await call("/pet");
      expect(frozen.status).toBe(200);
      expect(frozen.body.pet.status).toBe("cryo");
    });
  });

  it("does not keep suffering when coins are 0 but hunger and mood are still high", async () => {
    await asPetUser(9_001_109, async (call) => {
      const created = await call("/pet");
      expect(created.status).toBe(200);

      await sql`
        UPDATE pets
        SET coins = 0, hunger = 90, mood = 88, status = 'suffering',
            last_tick_at = now() - interval '2 hours',
            suffering_started_at = now() - interval '2 hours', cryo_at = NULL
        WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 9001109)
      `;
      const refreshed = await call("/pet");
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.pet.status).toBe("alive");
      expect(refreshed.body.pet.coins).toBe(0);
      expect(refreshed.body.pet.hunger).toBeGreaterThanOrEqual(PET.lowStat);
      expect(refreshed.body.pet.mood).toBeGreaterThanOrEqual(PET.lowStat);
    });
  });

  it("graduates when every catalog word is known and then skips upkeep", async () => {
    await asPetUser(9_001_103, async (call) => {
      await call("/pet");
      const users = await sql<{ id: string }[]>`
        SELECT id FROM users WHERE telegram_user_id = 9001103
      `;
      const userId = users[0].id;
      const wordIds = [...dictionary.words.keys()];
      const listed = catalogListings();
      expect(listed).toBeGreaterThan(wordIds.length);
      await sql`
        INSERT INTO word_progress (user_id, word_id, theme_id, status)
        SELECT ${userId}::bigint, unnest(${wordIds}::text[]), NULL::text, 'known'
      `;

      const won = await call("/pet");
      expect(won.status).toBe(200);
      expect(won.body.pet.status).toBe("graduated");
      expect(won.body.pet.knownCount).toBe(dictionary.words.size);
      expect(won.body.pet.totalWords).toBe(dictionary.words.size);
      const coins = won.body.pet.coins as number;

      await sql`
        UPDATE pets
        SET last_tick_at = now() - interval '5 hours'
        WHERE user_id = ${userId}::bigint
      `;
      const later = await call("/pet");
      expect(later.status).toBe(200);
      expect(later.body.pet.status).toBe("graduated");
      expect(later.body.pet.coins).toBe(coins);
    });
  });

  it("shows today's fact only after a successful care action", async () => {
    await asPetUser(9_001_301, async (call) => {
      const before = await call("/pet");
      expect(before.status).toBe(200);
      expect(before.body.fact).toBeNull();

      const fed = await call("/pet/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feed" }),
      });
      expect(fed.status).toBe(200);
      expect(fed.body.pet.coins).toBe(PET.startingCoins - PET.actionCost);
      expect(fed.body.fact.body.length).toBeGreaterThan(40);
      expect(fed.body.fact.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const again = await call("/pet");
      expect(again.body.fact.body).toBe(fed.body.fact.body);

      const played = await call("/pet/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "play" }),
      });
      expect(played.status).toBe(200);
      expect(played.body.fact.body).toBe(fed.body.fact.body);
      expect(played.body.pet.coins).toBe(PET.startingCoins - PET.actionCost * 2);
    });
  });

  it("does not unlock the fact when care is refused", async () => {
    await asPetUser(9_001_302, async (call) => {
      await call("/pet");
      await sql`
        UPDATE pets SET coins = 0
        WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 9001302)
      `;
      const denied = await call("/pet/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feed" }),
      });
      expect(denied.status).toBe(400);
      const after = await call("/pet");
      expect(after.status).toBe(200);
      expect(after.body.fact).toBeNull();
    });
  });
});

describe("onboarding", () => {
  async function asFreshUser<T>(telegramId: number, run: (call: typeof json) => Promise<T>): Promise<T> {
    const previousId = config.devTelegramUserId;
    const previousAuth = config.allowDevAuth;
    (config as { allowDevAuth: boolean }).allowDevAuth = true;
    (config as { devTelegramUserId: number }).devTelegramUserId = telegramId;
    const call: typeof json = async (path, init) => {
      const response = await app.request(path, {
        ...init,
        headers: {
          ...(config.botToken.includes("replace-me")
            ? { Authorization: "dev" }
            : { Authorization: `tma ${makeInitData(botToken, telegramId)}` }),
          ...(init?.headers ?? {}),
        },
      });
      const body = await response.json();
      return { status: response.status, body };
    };
    try {
      return await run(call);
    } finally {
      (config as { allowDevAuth: boolean }).allowDevAuth = previousAuth;
      (config as { devTelegramUserId: number }).devTelegramUserId = previousId;
      await sql`DELETE FROM pets WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM users WHERE telegram_user_id = ${telegramId}`;
    }
  }

  it("starts undone and persists after POST", async () => {
    await asFreshUser(9_001_201, async (call) => {
      const first = await call("/themes");
      expect(first.status).toBe(200);
      expect(first.body.onboardingDone).toBe(false);

      const marked = await call("/onboarding", { method: "POST" });
      expect(marked.status).toBe(200);
      expect(marked.body.ok).toBe(true);
      expect(marked.body.onboardingDone).toBe(true);

      const again = await call("/themes");
      expect(again.body.onboardingDone).toBe(true);

      const replay = await call("/onboarding", { method: "POST" });
      expect(replay.status).toBe(200);
      expect(replay.body.onboardingDone).toBe(true);
    });
  });

  it("stores each guide try once", async () => {
    await asFreshUser(9_001_202, async (call) => {
      const empty = await call("/themes");
      expect(empty.status).toBe(200);
      expect(empty.body.guideTries).toEqual([]);

      const first = await call("/guide", { method: "POST", body: JSON.stringify({ id: "words" }) });
      expect(first.status).toBe(200);
      expect(first.body.tries).toEqual(["words"]);

      const again = await call("/guide", { method: "POST", body: JSON.stringify({ id: "words" }) });
      expect(again.status).toBe(200);
      expect(again.body.tries).toEqual(["words"]);

      const second = await call("/guide", { method: "POST", body: JSON.stringify({ id: "moti" }) });
      expect(second.body.tries).toEqual(["moti", "words"]);

      const bad = await call("/guide", { method: "POST", body: JSON.stringify({ id: "nope" }) });
      expect(bad.status).toBe(400);

      const listed = await call("/themes");
      expect(listed.body.guideTries).toEqual(["moti", "words"]);
    });
  });

  it("builds a 12-word first-session pack across CEFR levels", async () => {
    await asFreshUser(9_001_203, async (call) => {
      const res = await call("/onboarding/session", { method: "POST" });
      expect(res.status).toBe(200);
      expect(res.body.session.words.length).toBe(12);
      expect(res.body.session.choices.length).toBe(24);
      expect(res.body.session.matchRounds.length).toBeGreaterThan(0);
      expect(res.body.dictionaryTarget).toBeTruthy();
      expect(typeof res.body.dictionaryTarget.word).toBe("string");
    });
  });
});

describe("text analysis", () => {
  afterAll(async () => {
    setClassifyUnknown(null);
    await unfile("flibberwock");
    await unfile("zindlequark");
    await sql`DELETE FROM catalog_words WHERE word_id IN ('flibberwock', 'zindlequark')`;
    await sql`DELETE FROM user_words WHERE word_id IN ('flibberwock', 'zindlequark')`;
  });

  it("recommends themes and adds unknown lemmas into categories", async () => {
    setClassifyUnknown(async (tokens) => {
      const out = [];
      if (tokens.includes("bought")) {
        out.push({ token: "bought", en: "buy", ru: ["покупать"], themeId: "shopping" });
      }
      if (tokens.includes("flibberwock")) {
        out.push({
          token: "flibberwock",
          en: "flibberwock",
          ru: ["вымышленное существо"],
          themeId: "travel",
        });
      }
      return out;
    });

    const wordsBefore = dictionary.words.size;
    const expectedTheme = themeForMediaWord({
      id: "flibberwock",
      en: "flibberwock",
      ru: ["вымышленное существо"],
    });
    expect(expectedTheme.startsWith("interest-")).toBe(true);
    const analyzed = await json("/texts/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: [
          {
            body: "I arrived at the airport early and bought a ticket to the hotel. A flibberwock waited beside the pond after breakfast.",
          },
        ],
      }),
    });
    expect(analyzed.status).toBe(200);
    expect(analyzed.body.texts.length).toBeGreaterThanOrEqual(1);
    const recs = analyzed.body.analysis.recommendations as { themeId: string; unknown: number }[];
    expect(analyzed.body.analysis.textIds.length).toBe(1);
    expect(recs.some((item) => item.themeId === "travel" && item.unknown > 0)).toBe(true);
    expect(
      recs.every((item) => {
        const theme = dictionary.getTheme(item.themeId);
        return theme && !dictionary.isMediaPack(theme);
      }),
    ).toBe(true);
    expect(analyzed.body.analysis.addedWords.some((word: { en: string }) => word.en === "flibberwock")).toBe(true);
    expect(analyzed.body.analysis.addedWords.some((word: { en: string }) => word.en === "buy")).toBe(false);
    const addedCard = analyzed.body.analysis.addedWords.find((word: { en: string }) => word.en === "flibberwock");
    expect(addedCard.themeId).toBe(expectedTheme);
    expect(addedCard.themeId).not.toBe("general");
    const filed = await readThemeFile(expectedTheme);
    expect(filed?.words.some((word) => word.id === "flibberwock")).toBe(true);
    const added = dictionary.getTheme(expectedTheme)?.words.find((word) => word.id === "flibberwock");
    expect(added?.level).toBe("B1");
    expect(added?.example.toLowerCase()).toContain("flibberwock");
    expect(dictionary.getTheme("general")?.words.some((word) => word.id === "flibberwock")).toBe(false);
    const catalogRow = await sql<{ theme_id: string }[]>`
      SELECT theme_id FROM catalog_words WHERE word_id = 'flibberwock'
    `;
    expect(catalogRow[0]?.theme_id).toBe(expectedTheme);

    const listed = await json("/texts");
    expect(listed.status).toBe(200);
    expect(listed.body.analysis?.added).toBeGreaterThan(0);

    const packId = `text:${analyzed.body.analysis.textIds[0]}`;
    const enrolled = await json("/studying", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeIds: [packId] }),
    });
    expect(enrolled.status).toBe(200);
    const themes = await json("/themes");
    expect(dictionary.words.size).toBeGreaterThan(wordsBefore);
    expect(themes.body.catalogWordCount).toBe(dictionary.words.size);
    const pack = themes.body.themes.find((theme: { id: string }) => theme.id === packId);
    expect(pack).toMatchObject({ id: packId, kind: "text", studying: true, paid: false, locked: false });
    expect(pack.wordCount).toBeGreaterThan(0);
    expect(pack.categories.length).toBeGreaterThan(0);

    const session = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: packId, mode: "learn" }),
    });
    expect(session.status).toBe(200);
    expect(session.body.words.length).toBeGreaterThan(0);

    const removed = await json("/studying", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeIds: [packId] }),
    });
    expect(removed.status).toBe(200);
    const after = await json("/themes");
    expect(after.body.themes.find((theme: { id: string }) => theme.id === packId)?.studying).toBeFalsy();
  });

  it("does not recount lemmas or duplicate a saved text on a second analyze", async () => {
    setClassifyUnknown(async (tokens) => {
      if (!tokens.includes("zindlequark")) return [];
      return [{ token: "zindlequark", en: "zindlequark", ru: ["выдумка"], themeId: "travel" }];
    });
    await sql`DELETE FROM user_studying WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_texts WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_text_runs WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_words WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM catalog_words WHERE word_id = 'zindlequark'`;
    dictionary.forget("zindlequark");

    const payload = {
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [{ body: "A zindlequark sat beside the pond after breakfast." }] }),
    };
    const first = await json("/texts/analyze", payload);
    expect(first.status).toBe(200);
    expect(first.body.analysis.added).toBeGreaterThan(0);
    expect(first.body.analysis.addedWords.some((word: { en: string }) => word.en === "zindlequark")).toBe(true);
    expect(first.body.texts.length).toBe(1);
    const firstId = first.body.analysis.textIds[0] as string;

    const second = await json("/texts/analyze", payload);
    expect(second.status).toBe(200);
    expect(second.body.analysis.added).toBe(0);
    expect(second.body.analysis.addedWords).toEqual([]);
    expect(second.body.texts.length).toBe(1);
    expect(second.body.analysis.textIds).toEqual([firstId]);

    const deleted = await json(`/texts/${firstId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const third = await json("/texts/analyze", payload);
    expect(third.status).toBe(200);
    expect(third.body.analysis.added).toBe(0);
    expect(third.body.analysis.addedWords).toEqual([]);
    expect(third.body.texts.length).toBe(1);
    expect(third.body.analysis.textIds[0]).toBeTruthy();
    expect(third.body.analysis.textIds[0]).not.toBe(firstId);
  });

  it("limits paid users to two new texts per 30 days, not counting re-analysis", async () => {
    setClassifyUnknown(async () => []);
    await sql`DELETE FROM user_texts WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_text_uploads WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`
      INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at)
      SELECT id, 9001002, 'monthly', 'regular', now() + interval '1 year'
      FROM users WHERE telegram_user_id = ${telegramUserId}
      ON CONFLICT (tribute_subscription_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, cancelled_at = NULL
    `;
    const post = (bodies: string[]) =>
      json("/texts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: bodies.map((body) => ({ body })) }),
      });

    try {
      const first = await post(["The train left the station before sunrise."]);
      expect(first.status).toBe(200);
      expect(first.body.quota).toMatchObject({ monthlyLimit: 2, monthlyUsed: 1, nextAt: null });

      const again = await post(["The train left the station before sunrise."]);
      expect(again.status).toBe(200);
      expect(again.body.quota.monthlyUsed).toBe(1);

      const second = await post(["We cooked dinner in the small kitchen."]);
      expect(second.status).toBe(200);
      expect(second.body.quota.monthlyUsed).toBe(2);
      expect(second.body.quota.nextAt).toBeTruthy();

      const third = await post(["A third text should be refused this month."]);
      expect(third.status).toBe(429);
      expect(third.body.code).toBe("text_quota");
      expect(third.body.error).toMatch(/2 новых текста/);

      const firstId = first.body.analysis.textIds[0] as string;
      await json(`/texts/${firstId}`, { method: "DELETE" });
      const afterDelete = await post(["Deleting a text does not give the slot back."]);
      expect(afterDelete.status).toBe(429);

      await sql`
        UPDATE user_text_uploads SET created_at = now() - interval '31 days'
        WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
      `;
      const nextWindow = await post(["A fresh window opens a slot."]);
      expect(nextWindow.status).toBe(200);
    } finally {
      // Saved texts stay so the free-tier test below still sees an occupied slot.
      await sql`DELETE FROM subscriptions WHERE tribute_subscription_id = 9001002`;
      await sql`DELETE FROM user_text_uploads WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    }
  });

  it("limits free users to one short text", async () => {
    const second = await json("/texts/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [{ body: "The hotel was near the station." }] }),
    });
    expect(second.status).toBe(400);
    await sql`DELETE FROM user_texts WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    const long = await json("/texts/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [{ body: "a".repeat(2001) }] }),
    });
    expect(long.status).toBe(400);
    expect(long.body.error).toMatch(/2000/);
  });

  it("drops deleted text ids from the last analysis and rejects enroll", async () => {
    setClassifyUnknown(async () => []);
    await sql`DELETE FROM user_studying WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_texts WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_text_runs WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;

    const analyzed = await json("/texts/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [{ body: "The cat sat on the mat near the window." }] }),
    });
    expect(analyzed.status).toBe(200);
    const textId = analyzed.body.analysis.textIds[0] as string;
    expect(textId).toBeTruthy();

    const deleted = await json(`/texts/${textId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(deleted.body.texts.some((item: { id: string }) => item.id === textId)).toBe(false);
    expect(deleted.body.analysis?.textIds ?? []).not.toContain(textId);

    const stored = await json("/texts");
    expect(stored.body.analysis?.textIds ?? []).not.toContain(textId);

    const enrolled = await json("/studying", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeIds: [`text:${textId}`] }),
    });
    expect(enrolled.status).toBe(404);
    expect(enrolled.body.code).toBe("not_found");

    const themes = await json("/themes");
    expect(themes.body.themes.some((theme: { id: string }) => theme.id === `text:${textId}`)).toBe(false);
  });

  it("keeps an enrolled text pack after the document is deleted", async () => {
    setClassifyUnknown(async () => []);
    await sql`DELETE FROM user_studying WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_texts WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`DELETE FROM user_text_runs WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;

    try {
      const analyzed = await json("/texts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [{ title: "У окна", body: "The cat sat on the mat near the window." }] }),
      });
      expect(analyzed.status).toBe(200);
      const textId = analyzed.body.analysis.textIds[0] as string;
      const packId = `text:${textId}`;
      const listed = await json(`/themes/${packId}/words`);
      expect(listed.status).toBe(200);
      const wordIds = (listed.body.words as { id: string }[]).map((word) => word.id);
      expect(wordIds.length).toBeGreaterThan(0);
      expect(listed.body.title).toBe("У окна");

      const enrolled = await json("/studying", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeIds: [packId] }),
      });
      expect(enrolled.status).toBe(200);

      const progressBefore = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM word_progress
        WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
      `;
      const catalogBefore = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM catalog_words`;

      const deleted = await json(`/texts/${textId}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(deleted.body.texts.some((item: { id: string }) => item.id === textId)).toBe(false);
      expect(deleted.body.analysis?.textIds ?? []).not.toContain(textId);

      const stored = await json("/texts");
      expect(stored.body.texts.some((item: { id: string }) => item.id === textId)).toBe(false);

      const themes = await json("/themes");
      const pack = themes.body.themes.find((theme: { id: string }) => theme.id === packId);
      expect(pack).toMatchObject({
        id: packId,
        kind: "text",
        title: "У окна",
        wordCount: wordIds.length,
      });
      expect(pack.studying).toBe(pack.knownCount < pack.wordCount);

      const after = await json(`/themes/${packId}/words`);
      expect(after.status).toBe(200);
      expect(after.body.title).toBe("У окна");
      expect((after.body.words as { id: string }[]).map((word) => word.id)).toEqual(wordIds);

      const session = await json("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: packId, mode: "learn" }),
      });
      if (pack.knownCount < pack.wordCount) {
        expect(session.status).toBe(200);
        const ids = new Set(wordIds);
        expect(session.body.words.length).toBeGreaterThan(0);
        expect(session.body.words.every((word: { id: string }) => ids.has(word.id))).toBe(true);
      }

      const progressAfter = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM word_progress
        WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
      `;
      const catalogAfter = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM catalog_words`;
      expect(progressAfter[0]?.count).toBe(progressBefore[0]?.count);
      expect(catalogAfter[0]?.count).toBe(catalogBefore[0]?.count);
    } finally {
      await sql`DELETE FROM user_studying WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
      await sql`DELETE FROM user_texts WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
      await sql`DELETE FROM user_text_runs WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    }
  });
});

describe("media packs", () => {
  it("lets a free user claim one movie or series", async () => {
    await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`UPDATE users SET free_media_id = NULL WHERE telegram_user_id = ${telegramUserId}`;
    await sql`DELETE FROM user_free_media WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    const claimed = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "shrek", mode: "learn" }),
    });
    expect(claimed.status).toBe(200);
    const themes = await json("/themes");
    expect(themes.body.themes.find((theme: { id: string }) => theme.id === "shrek")).toMatchObject({
      locked: false,
      claimable: false,
      freePick: true,
    });
    expect(themes.body.themes.find((theme: { id: string }) => theme.id === "lost-s01e01")).toMatchObject({
      locked: true,
      claimable: false,
    });
    const other = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "lost-s01e01", mode: "learn" }),
    });
    expect(other.status).toBe(403);
  });

  it("lists curated movie and series packs for the user to pick", async () => {
    await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    await sql`UPDATE users SET free_media_id = NULL WHERE telegram_user_id = ${telegramUserId}`;
    await sql`DELETE FROM user_free_media WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
    const themes = await json("/themes");
    expect(themes.status).toBe(200);
    expect(themes.body.blocks[0].id).toBe("media");
    const pack = themes.body.themes.find((theme: { id: string }) => theme.id === "lost-s01e01");
    expect(pack).toMatchObject({
      id: "lost-s01e01",
      kind: "episode",
      blockId: "media",
      paid: true,
      locked: false,
      claimable: true,
    });
    expect(
      themes.body.themes
        .filter((theme: { blockId: string }) => theme.blockId === "media")
        .every((theme: { paid: boolean; locked: boolean; claimable?: boolean }) => theme.paid && !theme.locked && theme.claimable),
    ).toBe(true);
    expect(pack.showId).toBe("lost");
    expect(pack.season).toBe(1);
    expect(pack.episode).toBe(1);
    expect(pack.posterUrl).toMatch(/^https?:\/\//);
    expect(pack.wordCount).toBeGreaterThan(5);
    expect(Array.isArray(pack.categories)).toBe(true);
    expect(pack.categories.length).toBeGreaterThan(0);
    expect(pack.categories.reduce((sum: number, item: { wordCount: number }) => sum + item.wordCount, 0)).toBe(
      pack.wordCount,
    );
    expect(pack.categories.every((item: { wordCount: number }) => item.wordCount > 0)).toBe(true);
    expect(dictionary.getTheme("lost-s01e01")?.words.some((word) => word.id === "airport")).toBe(true);

    const created = await app.request("/media", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nope", body: "airport" }),
    });
    expect(created.status).toBe(404);
  });

  it("starts a media session filtered by a catalog category from the pack", async () => {
    await sql`
      INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at)
      SELECT id, 9001002, 'monthly', 'regular', now() + interval '1 year'
      FROM users WHERE telegram_user_id = ${telegramUserId}
      ON CONFLICT (tribute_subscription_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, cancelled_at = NULL
    `;
    const themes = await json("/themes");
    const pack = themes.body.themes.find((theme: { id: string }) => theme.id === "lost-s01e01");
    expect(pack.locked).toBe(false);
    const category = pack.categories.find((item: { id: string }) => item.id === "travel") ?? pack.categories[0];
    const session = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "lost-s01e01", mode: "learn", categoryId: category.id }),
    });
    expect(session.status).toBe(200);
    expect(session.body.categoryId).toBe(category.id);
    expect(session.body.words.length).toBeGreaterThan(0);
    expect(session.body.words.length).toBeLessThanOrEqual(category.wordCount);
    const listed = await json("/themes");
    expect(listed.body.themes.find((theme: { id: string }) => theme.id === "lost-s01e01").studying).toBe(true);
  });
});

describe("category control and exam", () => {
  const telegramId = 9_001_220;

  async function asUser<T>(run: (call: typeof json) => Promise<T>): Promise<T> {
    const previousId = config.devTelegramUserId;
    const previousAuth = config.allowDevAuth;
    (config as { allowDevAuth: boolean }).allowDevAuth = true;
    (config as { devTelegramUserId: number }).devTelegramUserId = telegramId;
    const call: typeof json = async (path, init) => {
      const response = await app.request(path, {
        ...init,
        headers: {
          ...(config.botToken.includes("replace-me")
            ? { Authorization: "dev" }
            : { Authorization: `tma ${makeInitData(botToken, telegramId)}` }),
          ...(init?.headers ?? {}),
        },
      });
      const body = await response.json();
      return { status: response.status, body };
    };
    try {
      return await run(call);
    } finally {
      (config as { allowDevAuth: boolean }).allowDevAuth = previousAuth;
      (config as { devTelegramUserId: number }).devTelegramUserId = previousId;
      await sql`DELETE FROM pets WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM users WHERE telegram_user_id = ${telegramId}`;
    }
  }

  it("admits known words from before today, passes a one-letter typo, and opens the exam the day after control", async () => {
    await asUser(async (call) => {
      const travel = dictionary.getTheme("travel");
      expect(travel).toBeTruthy();
      const hotel = travel!.words.find((word) => word.en === "hotel");
      const motel = travel!.words.find((word) => word.en === "motel");
      const airport = travel!.words.find((word) => word.en === "airport");
      const flight = travel!.words.find((word) => word.en === "flight");
      const ticket = travel!.words.find((word) => word.en === "ticket");
      expect(hotel && motel && airport && flight && ticket).toBeTruthy();
      expect(travel!.words.some((word) => word.en.toLowerCase() === "hotal")).toBe(false);

      const today = "2030-06-01";
      const yesterday = "2030-05-31";
      const marked = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [airport!, hotel!, flight!, ticket!].map((word) => ({
            wordId: word.id,
            themeId: "travel",
            correct: 0,
            wrong: 0,
            known: true,
            awardCoins: false,
            knownOn: word.id === airport!.id ? today : yesterday,
          })),
        }),
      });
      expect(marked.status).toBe(200);
      expect(marked.body.coinsEarned).toBe(0);

      await sql`
        UPDATE word_progress
        SET known_on = NULL
        WHERE word_id = ${ticket!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
      `;

      const stored = await sql<{ word_id: string; status: string; control_passed: boolean; known_on: string | null }[]>`
        SELECT word_id, status, control_passed, known_on::text AS known_on
        FROM word_progress
        WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
          AND word_id IN (${airport!.id}, ${hotel!.id}, ${flight!.id}, ${ticket!.id})
      `;
      expect(stored.every((row) => row.status === "known" && row.control_passed === false)).toBe(true);

      const control = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "control", today }),
      });
      expect(control.status).toBe(200);
      expect(control.body.mode).toBe("control");
      expect(control.body.choices).toEqual([]);
      expect(control.body.matchRounds).toEqual([]);
      const controlIds = (control.body.words as { id: string }[]).map((word) => word.id);
      expect(new Set(controlIds)).toEqual(new Set([hotel!.id, flight!.id, ticket!.id]));
      expect(controlIds).not.toContain(airport!.id);

      const examBefore = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today }),
      });
      expect(examBefore.status).toBe(200);
      expect(examBefore.body.words).toEqual([]);

      const collided = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: "travel",
          mode: "control",
          wordId: hotel!.id,
          answer: motel!.en,
          today,
        }),
      });
      expect(collided.status).toBe(200);
      expect(collided.body.correct).toBe(false);

      const afterMiss = await sql<{ status: string; control_passed: boolean }[]>`
        SELECT status, control_passed
        FROM word_progress
        WHERE word_id = ${hotel!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
      `;
      expect(afterMiss[0]?.status).toBe("known");
      expect(afterMiss[0]?.control_passed).toBe(false);

      const stillClosed = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today }),
      });
      expect(stillClosed.body.words).toEqual([]);

      const typo = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: "travel",
          mode: "control",
          wordId: hotel!.id,
          answer: "hotal",
          today,
        }),
      });
      expect(typo.status).toBe(200);
      expect(typo.body.correct).toBe(true);

      const passedToday = await sql<{ status: string; control_passed: boolean; control_passed_on: string | null }[]>`
        SELECT status, control_passed, control_passed_on::text AS control_passed_on
        FROM word_progress
        WHERE word_id = ${hotel!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
      `;
      expect(passedToday[0]?.status).toBe("known");
      expect(passedToday[0]?.control_passed).toBe(true);
      expect(passedToday[0]?.control_passed_on).toBe(today);

      const controlAfterPass = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "control", today }),
      });
      const leftAfterPass = (controlAfterPass.body.words as { id: string }[]).map((word) => word.id);
      expect(leftAfterPass).not.toContain(hotel!.id);
      expect(new Set(leftAfterPass)).toEqual(new Set([flight!.id, ticket!.id]));

      const examAfter = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today }),
      });
      expect(examAfter.status).toBe(200);
      expect(examAfter.body.words).toEqual([]);

      const next = "2030-06-02";
      const examNext = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today: next }),
      });
      expect(examNext.status).toBe(200);
      expect((examNext.body.words as { id: string }[]).map((word) => word.id)).toEqual([hotel!.id]);

      const missedExam = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: "travel",
          mode: "review",
          wordId: hotel!.id,
          answer: "zzzzzz",
          today: next,
        }),
      });
      expect(missedExam.status).toBe(200);
      expect(missedExam.body.correct).toBe(false);
      const afterExamMiss = await sql<{ status: string; control_passed: boolean; exam_passed: boolean }[]>`
        SELECT status, control_passed, exam_passed
        FROM word_progress
        WHERE word_id = ${hotel!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
      `;
      expect(afterExamMiss[0]?.status).toBe("known");
      expect(afterExamMiss[0]?.control_passed).toBe(true);
      expect(afterExamMiss[0]?.exam_passed).toBe(false);
      const controlAfterExamMiss = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "control", today: next }),
      });
      expect((controlAfterExamMiss.body.words as { id: string }[]).map((word) => word.id)).not.toContain(hotel!.id);
      const examStill = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today: next }),
      });
      expect((examStill.body.words as { id: string }[]).map((word) => word.id)).toEqual([hotel!.id]);

      const passedExam = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: "travel",
          mode: "review",
          wordId: hotel!.id,
          answer: hotel!.en,
          today: next,
        }),
      });
      expect(passedExam.status).toBe(200);
      expect(passedExam.body.correct).toBe(true);
      const afterExamPass = await sql<{ status: string; control_passed: boolean; exam_passed: boolean }[]>`
        SELECT status, control_passed, exam_passed
        FROM word_progress
        WHERE word_id = ${hotel!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
      `;
      expect(afterExamPass[0]?.status).toBe("known");
      expect(afterExamPass[0]?.control_passed).toBe(true);
      expect(afterExamPass[0]?.exam_passed).toBe(true);
      const examDone = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today: next }),
      });
      expect(examDone.body.words).toEqual([]);

      const flightPass = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: "travel",
          mode: "control",
          wordId: flight!.id,
          answer: flight!.en,
          today,
        }),
      });
      expect(flightPass.status).toBe(200);
      expect(flightPass.body.correct).toBe(true);
      const controlWithoutFlight = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "control", today }),
      });
      expect((controlWithoutFlight.body.words as { id: string }[]).map((word) => word.id)).toEqual([ticket!.id]);

      const flightMiss = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: "travel",
          mode: "control",
          wordId: flight!.id,
          answer: "zzzzzz",
          today,
        }),
      });
      expect(flightMiss.status).toBe(200);
      expect(flightMiss.body.correct).toBe(false);
      const flightRow = await sql<{
        status: string;
        control_passed: boolean;
        control_passed_on: string | null;
      }[]>`
        SELECT status, control_passed, control_passed_on::text AS control_passed_on
        FROM word_progress
        WHERE word_id = ${flight!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
      `;
      expect(flightRow[0]?.status).toBe("known");
      expect(flightRow[0]?.control_passed).toBe(false);
      expect(flightRow[0]?.control_passed_on).toBeNull();
      const controlFlightBack = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "control", today }),
      });
      const back = (controlFlightBack.body.words as { id: string }[]).map((word) => word.id);
      expect(back).toContain(flight!.id);
      expect(back).toContain(ticket!.id);
      expect(back).not.toContain(hotel!.id);

      const cleared = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: hotel!.id, themeId: "travel", correct: 0, wrong: 0, known: false }],
        }),
      });
      expect(cleared.status).toBe(200);

      const controlAfter = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "control", today }),
      });
      const left = (controlAfter.body.words as { id: string }[]).map((word) => word.id);
      expect(left).not.toContain(hotel!.id);
      expect(new Set(left)).toEqual(new Set([flight!.id, ticket!.id]));

      const examCleared = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today }),
      });
      expect(examCleared.body.words).toEqual([]);

      const hotelRow = await sql<{
        status: string;
        control_passed: boolean;
        known_on: string | null;
        control_passed_on: string | null;
        exam_passed: boolean;
      }[]>`
        SELECT status, control_passed, known_on::text AS known_on,
               control_passed_on::text AS control_passed_on, exam_passed
        FROM word_progress
        WHERE word_id = ${hotel!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramId})
      `;
      expect(hotelRow[0]?.status).toBe("learning");
      expect(hotelRow[0]?.control_passed).toBe(false);
      expect(hotelRow[0]?.known_on).toBeNull();
      expect(hotelRow[0]?.control_passed_on).toBeNull();
      expect(hotelRow[0]?.exam_passed).toBe(false);
    });
  });
});

describe("film and document pools", () => {
  async function asUser<T>(telegramId: number, run: (call: typeof json) => Promise<T>): Promise<T> {
    const previousId = config.devTelegramUserId;
    const previousAuth = config.allowDevAuth;
    (config as { allowDevAuth: boolean }).allowDevAuth = true;
    (config as { devTelegramUserId: number }).devTelegramUserId = telegramId;
    const call: typeof json = async (path, init) => {
      const response = await app.request(path, {
        ...init,
        headers: {
          ...(config.botToken.includes("replace-me")
            ? { Authorization: "dev" }
            : { Authorization: `tma ${makeInitData(botToken, telegramId)}` }),
          ...(init?.headers ?? {}),
        },
      });
      const body = await response.json();
      return { status: response.status, body };
    };
    try {
      return await run(call);
    } finally {
      (config as { allowDevAuth: boolean }).allowDevAuth = previousAuth;
      (config as { devTelegramUserId: number }).devTelegramUserId = previousId;
      await sql`DELETE FROM pets WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM user_studying WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramId})`;
      await sql`DELETE FROM users WHERE telegram_user_id = ${telegramId}`;
    }
  }

  function idsOf(body: { words?: { id: string }[] }): string[] {
    return (body.words ?? []).map((word) => word.id);
  }

  it("uses global known-day and control on a film pack, with typos against that pack", async () => {
    await asUser(9_001_221, async (call) => {
      const pack = dictionary.getTheme("the-grand-tour-s01e01");
      const travel = dictionary.getTheme("travel");
      expect(pack && travel).toBeTruthy();
      const hotel = pack!.words.find((word) => word.en === "hotel");
      const ticket = pack!.words.find((word) => word.en === "ticket");
      const shirt = pack!.words.find((word) => word.en === "shirt");
      const plane = pack!.words.find((word) => word.en === "plane");
      const airport = travel!.words.find((word) => word.en === "airport");
      expect(hotel && ticket && shirt && plane && airport).toBeTruthy();
      expect(pack!.words.some((word) => word.en.toLowerCase() === "shart")).toBe(false);
      expect(pack!.words.some((word) => word.en.toLowerCase() === "short")).toBe(true);
      expect(travel!.words.some((word) => word.id === airport!.id)).toBe(true);
      expect(pack!.words.some((word) => word.id === airport!.id)).toBe(false);

      const today = "2030-06-01";
      const yesterday = "2030-05-31";
      const marked = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { wordId: hotel!.id, themeId: "travel", knownOn: yesterday },
            { wordId: ticket!.id, themeId: "travel", knownOn: yesterday },
            { wordId: shirt!.id, themeId: "travel", knownOn: yesterday },
            { wordId: airport!.id, themeId: "travel", knownOn: yesterday },
            { wordId: plane!.id, themeId: "travel", knownOn: today },
          ].map((item) => ({ ...item, correct: 0, wrong: 0, known: true, awardCoins: false })),
        }),
      });
      expect(marked.status).toBe(200);
      expect(marked.body.coinsEarned).toBe(0);

      const control = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "control", today }),
      });
      expect(control.status).toBe(200);
      expect(new Set(idsOf(control.body))).toEqual(new Set([hotel!.id, ticket!.id, shirt!.id]));

      const byLevel = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "control", level: "A1", today }),
      });
      expect(byLevel.status).toBe(200);
      expect(new Set(idsOf(byLevel.body))).toEqual(new Set([hotel!.id, shirt!.id]));

      const collided = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: pack!.id,
          mode: "control",
          wordId: shirt!.id,
          answer: "short",
          today,
        }),
      });
      expect(collided.status).toBe(200);
      expect(collided.body.correct).toBe(false);

      const typo = await call("/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: pack!.id,
          mode: "control",
          wordId: hotel!.id,
          answer: "hotal",
          level: "A1",
          today,
        }),
      });
      expect(typo.status).toBe(200);
      expect(typo.body.correct).toBe(true);

      const passed = await sql<{ control_passed: boolean }[]>`
        SELECT control_passed
        FROM word_progress
        WHERE word_id = ${hotel!.id}
          AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${9_001_221})
      `;
      expect(passed[0]?.control_passed).toBe(true);

      const controlAfterPass = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "control", today }),
      });
      expect(new Set(idsOf(controlAfterPass.body))).toEqual(new Set([ticket!.id, shirt!.id]));

      const examToday = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "review", today }),
      });
      expect(examToday.body.words).toEqual([]);
      const themeExamToday = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today }),
      });
      expect(themeExamToday.body.words).toEqual([]);

      const next = "2030-06-02";
      const exam = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "review", today: next }),
      });
      expect(new Set(idsOf(exam.body))).toEqual(new Set([hotel!.id]));

      const themeExam = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: "travel", mode: "review", today: next }),
      });
      expect(idsOf(themeExam.body)).toEqual([hotel!.id]);

      const cleared = await call("/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ wordId: hotel!.id, themeId: "travel", correct: 0, wrong: 0, known: false }],
        }),
      });
      expect(cleared.status).toBe(200);

      const controlAfter = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "control", today }),
      });
      expect(new Set(idsOf(controlAfter.body))).toEqual(new Set([ticket!.id, shirt!.id]));
      const examAfter = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "review", today }),
      });
      expect(examAfter.body.words).toEqual([]);

      const learn = await call("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: pack!.id, mode: "learn", level: "A1" }),
      });
      expect(learn.status).toBe(200);
      expect(learn.body.words.length).toBeGreaterThan(0);
      expect(learn.body.words.length).toBeLessThanOrEqual(SESSION_MAX);
      expect(learn.body.words.every((word: { level: string }) => word.level === "A1")).toBe(true);
      for (const word of learn.body.words as { id: string; en: string; example: string }[]) {
        const source = pack!.words.find((item) => item.id === word.id);
        expect(word.example).toBe(shortSubtitleLine(source?.example ?? "", word.en));
        expect(word.example.length).toBeLessThanOrEqual(140);
      }
    });
  });

  it("limits a document session like a theme and keeps control inside that text", async () => {
    await asUser(9_001_222, async (call) => {
      setClassifyUnknown(async () => []);
      try {
        const created = await call("/themes");
        expect(created.status).toBe(200);
        await sql`
          INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at)
          SELECT id, 9001222, 'monthly', 'regular', now() + interval '1 year'
          FROM users WHERE telegram_user_id = ${9_001_222}
          ON CONFLICT (tribute_subscription_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, cancelled_at = NULL
        `;

        const wanted = ["hotel", "motel"];
        const seen = new Set<string>([...wanted, "airport", "hotal"]);
        const extra: string[] = [];
        for (const word of dictionary.words.values()) {
          const en = word.en.toLowerCase();
          if (!/^[a-z]{6,12}$/.test(en) || seen.has(en)) continue;
          seen.add(en);
          extra.push(en);
          if (extra.length >= 40) break;
        }
        const bodyA = [...wanted, ...extra].map((en) => `The ${en} stayed.`).join(" ");
        const analyzed = await call("/texts/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts: [{ body: bodyA }, { body: "The airport." }],
          }),
        });
        expect(analyzed.status).toBe(200);
        const [idA, idB] = analyzed.body.analysis.textIds as string[];
        expect(idA && idB).toBeTruthy();
        const packA = `text:${idA}`;
        const packB = `text:${idB}`;

        const listed = await call(`/themes/${packA}/words`);
        expect(listed.status).toBe(200);
        const words = listed.body.words as { id: string; en: string }[];
        expect(words.length).toBeGreaterThan(SESSION_MAX + 1);
        const hotel = words.find((word) => word.en === "hotel");
        const motel = words.find((word) => word.en === "motel");
        expect(hotel && motel).toBeTruthy();
        expect(words.some((word) => word.en === "airport" || word.en === "hotal")).toBe(false);

        const learn = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packA, mode: "learn" }),
        });
        expect(learn.status).toBe(200);
        expect(learn.body.words.length).toBe(SESSION_MAX);
        const match = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packA, mode: "match" }),
        });
        expect(match.body.words.length).toBe(SESSION_MAX);

        const ordered = [hotel!.id, motel!.id, ...words.map((word) => word.id).filter((id) => id !== hotel!.id && id !== motel!.id)];
        const yesterdayIds = ordered.slice(0, SESSION_MAX + 1);
        const todayId = ordered[SESSION_MAX + 1];
        expect(todayId).toBeTruthy();
        const today = "2030-06-01";
        const yesterday = "2030-05-31";
        const marked = await call("/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              ...yesterdayIds.map((wordId) => ({
                wordId,
                themeId: "travel",
                correct: 0,
                wrong: 0,
                known: true,
                awardCoins: false,
                knownOn: yesterday,
              })),
              {
                wordId: todayId,
                themeId: packA,
                correct: 0,
                wrong: 0,
                known: true,
                awardCoins: false,
                knownOn: today,
              },
              {
                wordId: "airport",
                themeId: "travel",
                correct: 0,
                wrong: 0,
                known: true,
                awardCoins: false,
                knownOn: yesterday,
              },
            ],
          }),
        });
        expect(marked.status).toBe(200);
        expect(marked.body.coinsEarned).toBe(0);

        const control = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packA, mode: "control", today }),
        });
        expect(control.status).toBe(200);
        expect(new Set(idsOf(control.body))).toEqual(new Set(yesterdayIds));
        expect(idsOf(control.body)).not.toContain(todayId);
        expect(idsOf(control.body)).not.toContain("airport");

        const other = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packB, mode: "control", today }),
        });
        expect(idsOf(other.body)).toEqual(["airport"]);

        const collided = await call("/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            themeId: packA,
            mode: "control",
            wordId: hotel!.id,
            answer: "motel",
            today,
          }),
        });
        expect(collided.body.correct).toBe(false);
        const typo = await call("/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            themeId: packA,
            mode: "control",
            wordId: hotel!.id,
            answer: "hotal",
            today,
          }),
        });
        expect(typo.body.correct).toBe(true);

        const examToday = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packA, mode: "review", today }),
        });
        expect(examToday.body.words).toEqual([]);
        const exam = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packA, mode: "review", today: "2030-06-02" }),
        });
        expect(idsOf(exam.body)).toEqual([hotel!.id]);

        const cleared = await call("/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ wordId: hotel!.id, themeId: packA, correct: 0, wrong: 0, known: false }],
          }),
        });
        expect(cleared.status).toBe(200);
        const controlAfter = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packA, mode: "control", today }),
        });
        expect(idsOf(controlAfter.body)).not.toContain(hotel!.id);
        const examAfter = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packA, mode: "review", today }),
        });
        expect(examAfter.body.words).toEqual([]);
        const otherAfter = await call("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId: packB, mode: "control", today }),
        });
        expect(idsOf(otherAfter.body)).toEqual(["airport"]);
      } finally {
        setClassifyUnknown(null);
      }
    });
  });
});

function frenchWord(id: string, word: string, ru: string): DictWord {
  return {
    id,
    word,
    en: word,
    ru: [ru],
    example: `${word}.`,
    level: "A1",
    pos: "n",
    gender: "f",
  };
}

function seedFrenchCatalog() {
  const fr = getDictionary("fr");
  const banque = frenchWord("zz-banque", "banque", "банк");
  const maison = frenchWord("zz-maison", "maison", "дом");
  fr.themes.set("numbers", {
    id: "numbers",
    title: "Числа",
    paid: false,
    blockId: "start",
    words: [banque, maison],
  });
  fr.themes.set("colors", {
    id: "colors",
    title: "Цвета",
    paid: false,
    blockId: "start",
    words: [maison],
  });
  fr.themes.set("zz-fr-film", {
    id: "zz-fr-film",
    title: "Фильм",
    paid: true,
    blockId: "media",
    kind: "movie",
    words: [banque],
  });
  for (const word of [banque, maison]) {
    fr.words.set(word.id, word);
    fr.wordThemes.set(word.id, ["numbers"]);
  }
  fr.wordThemes.set("zz-maison", ["numbers", "colors"]);
  fr.wordThemes.set("zz-banque", ["numbers", "zz-fr-film"]);
}

function clearFrenchCatalog() {
  const fr = getDictionary("fr");
  fr.themes.clear();
  fr.words.clear();
  fr.wordThemes.clear();
  fr.blocks.length = 0;
}

async function resetLanguageUser() {
  await sql`
    UPDATE users
    SET language = 'en', language_chosen = false, free_media_id = NULL
    WHERE telegram_user_id = ${telegramUserId}
  `;
  await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM user_studying WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM user_study_words WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM user_free_media WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  clearFrenchCatalog();
}

describe("languages", () => {
  const today = "2030-06-01";

  beforeEach(resetLanguageUser);
  afterEach(resetLanguageUser);

  it("keeps migration row counts and defaults existing rows to en", async () => {
    expect(languageTableCounts.length).toBe(LANGUAGE_COUNT_TABLES.length);
    for (const row of languageTableCounts) {
      expect(row.after, row.table).toBe(row.before);
    }
    const columns = await sql<{ table_name: string; column_name: string; is_nullable: string }[]>`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE (table_name = 'users' AND column_name IN ('language', 'language_chosen'))
         OR (table_name IN ('word_progress', 'user_study_words', 'user_words', 'user_studying', 'catalog_words') AND column_name = 'language')
    `;
    expect(columns).toHaveLength(7);
    expect(columns.every((column) => column.is_nullable === "NO")).toBe(true);
    const blanks = await sql<{ n: number }[]>`
      SELECT (
        (SELECT count(*) FROM users WHERE language IS NULL) +
        (SELECT count(*) FROM word_progress WHERE language IS NULL) +
        (SELECT count(*) FROM user_study_words WHERE language IS NULL) +
        (SELECT count(*) FROM user_words WHERE language IS NULL) +
        (SELECT count(*) FROM user_studying WHERE language IS NULL) +
        (SELECT count(*) FROM catalog_words WHERE language IS NULL)
      )::int AS n
    `;
    expect(blanks[0]?.n).toBe(0);
  });

  it("lists only English and rejects a language that is not available", async () => {
    const me = await json("/me");
    expect(me.status).toBe(200);
    expect(me.body.language).toBe("en");
    expect(me.body.languageChosen).toBe(false);
    expect(me.body.languages).toEqual(availableLanguages());
    expect(me.body.activeLanguage).toEqual(me.body.languages[0]);
    const themes = await json("/themes");
    expect(themes.body.language).toBe("en");
    expect(themes.body.languages).toHaveLength(availableLanguages().length);
    const health = await json("/health");
    expect(themes.body.catalogWordCount).toBe(health.body.words);
    expect(health.body.words).toBe(dictionary.words.size);

    const french = await json("/me/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "fr" }),
    });
    expect(french.status).toBe(availableLanguages().some((item) => item.code === "fr") ? 200 : 400);
    const unknown = await json("/me/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "xx" }),
    });
    expect(unknown.status).toBe(400);
    const english = await json("/me/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });
    expect(english.status).toBe(200);
    expect(english.body.language).toBe("en");
    expect(english.body.languageChosen).toBe(true);

    const learn = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "numbers", mode: "learn" }),
    });
    expect(learn.status).toBe(200);
    const card = (learn.body.words as { word: string; en: string }[])[0];
    expect(card.word).toBe(card.en);
  });

  it("strips a leading article and keeps a one-edit typo inside the current pool", () => {
    expect(recallAnswerCorrect("la banque", "banque", ["banque", "maison"], "fr")).toBe(true);
    expect(recallAnswerCorrect("le banque", "banque", ["banque", "maison"], "fr")).toBe(true);
    expect(recallAnswerCorrect("banques", "banque", ["banque", "banques"], "fr")).toBe(false);
    expect(recallAnswerCorrect("the hotel", "hotel", ["hotel", "motel"], "en")).toBe(true);
    expect(recallAnswerCorrect("hotal", "hotel", ["hotel", "motel"], "en")).toBe(true);
    expect(recallAnswerCorrect("motel", "hotel", ["hotel", "motel"], "en")).toBe(false);
    expect(recallAcceptsAnswer("догађај", ["događaj", "догађај"], ["događaj", "догађај", "ići"], "sr")).toBe(true);
    expect(recallAcceptsAnswer("događaj", ["događaj", "догађај"], ["događaj", "догађај"], "sr")).toBe(true);
    expect(recallAcceptsAnswer("догађај", ["događaj"], ["događaj"], "sr")).toBe(false);
  });

  it("isolates progress, control, and exam by the user language", async () => {
    const numbers = dictionary.getTheme("numbers");
    expect(numbers && numbers.words.length).toBeGreaterThan(1);
    const english = numbers!.words[0];
    await json("/me");
    const marked = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: english.id, themeId: "numbers", correct: 0, wrong: 0, known: true, awardCoins: false, knownOn: "2020-01-01" }],
      }),
    });
    expect(marked.status).toBe(200);
    const stored = await sql<{ language: string }[]>`
      SELECT language FROM word_progress
      WHERE word_id = ${english.id}
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(stored.map((row) => row.language)).toEqual(["en"]);

    const control = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "numbers", mode: "control", today }),
    });
    expect((control.body.words as { id: string; word: string; en: string }[]).some((word) => word.id === english.id && word.word === word.en)).toBe(true);
    const exam = await json("/exam", { method: "POST" });
    expect(exam.status).toBe(200);
    expect((exam.body.words as { id: string }[]).map((word) => word.id)).toContain(english.id);

    await sql`UPDATE users SET language = 'fr' WHERE telegram_user_id = ${telegramUserId}`;
    seedFrenchCatalog();
    const frenchMe = await json("/me");
    expect(frenchMe.body.language).toBe("fr");
    expect(frenchMe.body.languages.map((item: { code: string }) => item.code)).toEqual(
      availableLanguages().map((item) => item.code),
    );
    expect(frenchMe.body.activeLanguage).toEqual({
      code: "fr",
      title: "Французский",
      voice: "fr-FR",
      dictionary: true,
      texts: true,
      mediaRequests: true,
    });
    const hidden = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "numbers", mode: "control", today }),
    });
    expect((hidden.body.words as { id: string }[]).map((word) => word.id)).not.toContain(english.id);
    const hiddenExam = await json("/exam", { method: "POST" });
    expect(hiddenExam.status).toBe(400);

    const frenchMarked = await json("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "zz-banque", themeId: "numbers", correct: 0, wrong: 0, known: true, awardCoins: false, knownOn: "2020-01-01" }],
      }),
    });
    expect(frenchMarked.status).toBe(200);
    const frenchControl = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "numbers", mode: "control", today }),
    });
    expect((frenchControl.body.words as { id: string; word: string }[]).map((word) => word.id)).toEqual(["zz-banque"]);
    expect(frenchControl.body.words[0].word).toBe("banque");
    const frenchExam = await json("/exam", { method: "POST" });
    expect((frenchExam.body.words as { id: string }[]).map((word) => word.id)).toEqual(["zz-banque"]);

    await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = ${telegramUserId}`;
    const back = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "numbers", mode: "control", today }),
    });
    const backIds = (back.body.words as { id: string }[]).map((word) => word.id);
    expect(backIds).toContain(english.id);
    expect(backIds).not.toContain("zz-banque");
    const backExam = await json("/exam", { method: "POST" });
    const examIds = (backExam.body.words as { id: string }[]).map((word) => word.id);
    expect(examIds).toContain(english.id);
    expect(examIds).not.toContain("zz-banque");
    const both = await sql<{ language: string; word_id: string }[]>`
      SELECT language, word_id FROM word_progress
      WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
      ORDER BY language, word_id
    `;
    expect(both).toEqual([
      { language: "en", word_id: english.id },
      { language: "fr", word_id: "zz-banque" },
    ]);
  });

  it("counts a free film, studying, and my words separately per language", async () => {
    await json("/me");
    const claimed = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "shrek", mode: "learn" }),
    });
    expect(claimed.status).toBe(200);
    const claims = await sql<{ language: string; free_media_id: string }[]>`
      SELECT language, free_media_id FROM user_free_media
      WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(claims).toEqual([{ language: "en", free_media_id: "shrek" }]);

    const enrolled = await json("/studying", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeIds: ["numbers"] }),
    });
    expect(enrolled.status).toBe(200);
    const sample = dictionary.getTheme("numbers")!.words[0];
    const saved = await json("/dictionary/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId: sample.id }),
    });
    expect(saved.status).toBe(200);

    const englishThemes = await json("/themes");
    expect(englishThemes.body.themes.find((theme: { id: string }) => theme.id === "shrek").freePick).toBe(true);
    expect(englishThemes.body.themes.find((theme: { id: string }) => theme.id === "numbers").studying).toBe(true);
    const mine = await json("/themes/my-words/words");
    expect((mine.body.words as { id: string }[]).map((word) => word.id)).toContain(sample.id);

    await sql`UPDATE users SET language = 'fr' WHERE telegram_user_id = ${telegramUserId}`;
    seedFrenchCatalog();
    await sql`
      INSERT INTO user_studying (user_id, language, theme_id)
      SELECT id, 'fr', 'colors' FROM users WHERE telegram_user_id = ${telegramUserId}
    `;
    await sql`
      INSERT INTO user_study_words (user_id, language, word_id)
      SELECT id, 'fr', 'zz-banque' FROM users WHERE telegram_user_id = ${telegramUserId}
    `;
    const frenchThemes = await json("/themes");
    expect(frenchThemes.body.themes.find((theme: { id: string }) => theme.id === "shrek")).toBeUndefined();
    expect(frenchThemes.body.themes.find((theme: { id: string }) => theme.id === "numbers").studying).toBe(false);
    expect(frenchThemes.body.themes.find((theme: { id: string }) => theme.id === "colors").studying).toBe(true);
    const frenchMine = await json("/themes/my-words/words");
    expect((frenchMine.body.words as { id: string }[]).map((word) => word.id)).toEqual(["zz-banque"]);

    const other = await json("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "zz-fr-film", mode: "learn" }),
    });
    expect(other.status).toBe(200);
    const bothClaims = await sql<{ language: string; free_media_id: string }[]>`
      SELECT language, free_media_id FROM user_free_media
      WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
      ORDER BY language
    `;
    expect(bothClaims).toEqual([
      { language: "en", free_media_id: "shrek" },
      { language: "fr", free_media_id: "zz-fr-film" },
    ]);

    await sql`UPDATE users SET language = 'en' WHERE telegram_user_id = ${telegramUserId}`;
    const restored = await json("/themes");
    expect(restored.body.themes.find((theme: { id: string }) => theme.id === "shrek").freePick).toBe(true);
    expect(restored.body.themes.find((theme: { id: string }) => theme.id === "numbers").studying).toBe(true);
    expect(restored.body.themes.find((theme: { id: string }) => theme.id === "colors").studying).toBe(false);
    const restoredMine = await json("/themes/my-words/words");
    const restoredIds = (restoredMine.body.words as { id: string }[]).map((word) => word.id);
    expect(restoredIds).toContain(sample.id);
    expect(restoredIds).not.toContain("zz-banque");
  });
});


