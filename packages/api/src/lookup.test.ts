import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { setDefineDictionaryWord, type DefinedWord } from "./ai.js";
import { makeInitData } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { enterLanguage } from "./catalogContext.js";
import { dictionary, getDictionary } from "./dictionary.js";
import { themeForMediaWord } from "./interests.js";
import { migrate } from "./migrate.js";
import { PET } from "./pet.js";
import { readThemeFile, writeThemeFile } from "./themeFile.js";
import { searchDictionary, type DictionarySearch } from "./lookup.js";
import { setWiktionaryLookup } from "./wiktionary.js";
import type { AppUser } from "./types.js";

const app = createApp();
const telegramUserId = 9_001_007;
const botToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;
const freshId = "lookuptestword";

function authHeaders() {
  if (config.allowDevAuth && config.botToken.includes("replace-me")) {
    return { Authorization: "dev" };
  }
  return { Authorization: `tma ${makeInitData(botToken, telegramUserId)}` };
}

async function request(path: string, init?: RequestInit) {
  const response = await app.request(path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json()) as DictionarySearch };
}

async function call<T>(path: string, init?: RequestInit) {
  const response = await app.request(path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json()) as T };
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

beforeAll(async () => {
  await migrate();
  if (dictionary.words.size === 0) await dictionary.load();
  await unfile(freshId);
  await sql`DELETE FROM catalog_words WHERE word_id = ${freshId}`;
  await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
});

afterAll(async () => {
  setDefineDictionaryWord(null);
  setWiktionaryLookup(null);
  await unfile(freshId);
  await sql`DELETE FROM catalog_words WHERE word_id = ${freshId}`;
  await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
});

describe("dictionary lookup", () => {
  it("finds a catalog word and a prefix without calling AI", async () => {
    const define = vi.fn(async () => null);
    setDefineDictionaryWord(define);

    const exact = await request("/dictionary?q=airport");
    expect(exact.status).toBe(200);
    expect(exact.body.exact).toBe(true);
    expect(exact.body.added).toBe(false);
    expect(exact.body.hits.some((hit) => hit.id === "airport" && hit.ru.length > 0)).toBe(true);
    expect(define).not.toHaveBeenCalled();

    const prefix = await request("/dictionary?q=airp");
    expect(prefix.body.exact).toBe(false);
    expect(prefix.body.hits.some((hit) => hit.id === "airport")).toBe(true);

    const gloss = (dictionary.getWord("airport")?.ru[0] ?? "").split(/[,/]/)[0]?.trim() ?? "";
    expect(gloss.length).toBeGreaterThan(1);
    const russian = await request(`/dictionary?q=${encodeURIComponent(gloss)}`);
    expect(russian.body.exact).toBe(true);
    expect(russian.body.hits.some((hit) => hit.id === "airport")).toBe(true);
  });

  it("finds a stored phrase and ranks an exact match ahead of a partial one", async () => {
    const define = vi.fn(async () => null);
    setDefineDictionaryWord(define);

    const according = await request(`/dictionary?q=${encodeURIComponent("according to")}`);
    expect(according.body.exact).toBe(true);
    expect(according.body.hits[0]?.id).toBe("according-to");
    expect(according.body.hits.some((hit) => hit.id === "word")).toBe(false);
    expect(define).not.toHaveBeenCalled();

    const forward = await request(`/dictionary?q=${encodeURIComponent("look forward")}`);
    expect(forward.body.exact).toBe(true);
    expect(forward.body.hits.some((hit) => hit.id === "look-forward-to")).toBe(true);
    expect(define).not.toHaveBeenCalled();

    const ranked = await request(`/dictionary?q=${encodeURIComponent("give up")}`);
    expect(ranked.body.exact).toBe(true);
    expect(ranked.body.hits[0]?.en.toLowerCase()).toBe("give up");
    const doing = ranked.body.hits.findIndex((hit) => hit.id === "give-up-doing");
    expect(doing).toBeGreaterThan(0);

    const gloss = await request(`/dictionary?q=${encodeURIComponent("по крайней мере")}`);
    expect(gloss.body.exact).toBe(true);
    expect(gloss.body.hits[0]?.id).toBe("at-least");
    expect(gloss.body.hits.some((hit) => hit.id === "word")).toBe(false);

    const prefix = await request("/dictionary?q=airp");
    expect(prefix.body.exact).toBe(false);
    expect(prefix.body.hits.some((hit) => hit.id === "airport")).toBe(true);
  });

  it("finds the same phrase in the French catalog", async () => {
    const french = getDictionary("fr");
    if (french.words.size === 0) await french.load();
    const guest: AppUser = {
      id: "0",
      telegramUserId: 0,
      telegramUsername: null,
      subscribed: false,
      freeMediaId: null,
      dev: true,
      onboardingDone: true,
      language: "fr",
      languageChosen: true,
    };
    const found = await enterLanguage("fr", () => searchDictionary(guest, "au moins"));
    expect(found.exact).toBe(true);
    expect(found.hits[0]?.id).toBe("au-moins");

    const partial = await enterLanguage("fr", () => searchDictionary(guest, "avoir hâte"));
    expect(partial.exact).toBe(true);
    expect(partial.hits.some((hit) => hit.id === "avoir-hate-de")).toBe(true);

    const plain = await enterLanguage("fr", () => searchDictionary(guest, "avoir hate"));
    expect(plain.hits.some((hit) => hit.id === "avoir-hate-de")).toBe(true);

    const gloss = await enterLanguage("fr", () => searchDictionary(guest, "по крайней мере"));
    expect(gloss.exact).toBe(true);
    expect(gloss.hits[0]?.id).toBe("au-moins");
    expect(gloss.hits.some((hit) => hit.id === "word")).toBe(false);
  });

  it("shows all three forms when the query is an irregular verb", async () => {
    const past = await request("/dictionary?q=went");
    expect(past.status).toBe(200);
    expect(past.body.exact).toBe(true);
    const go = past.body.hits.find((hit) => hit.id === "go");
    expect(go?.forms).toEqual(["go", "went", "gone"]);

    const lemma = await request("/dictionary?q=go");
    expect(lemma.body.hits.find((hit) => hit.id === "go")?.forms).toEqual(["go", "went", "gone"]);

    const be = await request("/dictionary?q=was");
    expect(be.body.hits.some((hit) => hit.forms?.[0] === "be" && hit.forms[1] === "was/were" && hit.forms[2] === "been")).toBe(
      true,
    );

    const plain = await request("/dictionary?q=airport");
    expect(plain.body.hits.every((hit) => hit.forms == null)).toBe(true);
  });

  it("offers a close spelling and does not store the typo", async () => {
    const define = vi.fn(async () => null);
    setDefineDictionaryWord(define);

    const typed = await request("/dictionary?q=airprot");
    expect(typed.body.exact).toBe(false);
    expect(typed.body.corrected).toBe(true);
    expect(typed.body.added).toBe(false);
    expect(typed.body.hits.some((hit) => hit.id === "airport")).toBe(true);
    expect(define).not.toHaveBeenCalled();

    const fixed = await request("/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "airprot" }),
    });
    expect(fixed.body.corrected).toBe(true);
    expect(fixed.body.added).toBe(false);
    expect(fixed.body.hits.some((hit) => hit.id === "airport")).toBe(true);
    expect(define).not.toHaveBeenCalled();
    const rows = await sql<{ word_id: string }[]>`
      SELECT word_id FROM catalog_words WHERE word_id = 'airprot'
    `;
    expect(rows).toEqual([]);
  });

  it("keeps a corrected lemma instead of the misspelling", async () => {
    const defined: DefinedWord = {
      en: "airport",
      ru: ["аэропорт"],
      themeId: "travel",
      pos: "noun",
      example: "We arrived at the airport early.",
      level: "A2",
    };
    const define = vi.fn(async () => defined);
    setDefineDictionaryWord(define);
    const fixed = await request("/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "qxairport" }),
    });
    expect(fixed.body.exact).toBe(true);
    expect(fixed.body.corrected).toBe(true);
    expect(fixed.body.added).toBe(false);
    expect(fixed.body.hits.some((hit) => hit.id === "airport")).toBe(true);
    expect(define).toHaveBeenCalledTimes(1);
  });

  it("asks AI only when the word is missing and stores one shared card", async () => {
    const defined: DefinedWord = {
      en: freshId,
      ru: ["проверочное слово"],
      themeId: "general",
      pos: "noun",
      example: "A lookuptestword sat quietly.",
      level: "B2",
    };
    const define = vi.fn(async () => defined);
    setDefineDictionaryWord(define);
    const expectedTheme = themeForMediaWord({
      id: freshId,
      en: freshId,
      ru: ["проверочное слово"],
    });
    expect(expectedTheme.startsWith("interest-")).toBe(true);

    const created = await request("/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: freshId }),
    });
    expect(created.status).toBe(200);
    expect(created.body.added).toBe(true);
    expect(created.body.exact).toBe(true);
    expect(created.body.hits[0]).toMatchObject({
      id: freshId,
      ru: ["проверочное слово"],
      themeId: expectedTheme,
      level: "B2",
      pos: "n",
    });
    expect(created.body.hits[0]?.themeId).not.toBe("general");
    const filed = await readThemeFile(expectedTheme);
    expect(filed?.words.some((word) => word.id === freshId)).toBe(true);
    expect(dictionary.getTheme(expectedTheme)?.words.some((word) => word.id === freshId)).toBe(true);
    expect(dictionary.getTheme("general")?.words.some((word) => word.id === freshId)).toBe(false);
    expect(define).toHaveBeenCalledTimes(1);

    const again = await request("/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: freshId }),
    });
    expect(again.body.added).toBe(false);
    expect(again.body.hits[0]?.id).toBe(freshId);
    expect(define).toHaveBeenCalledTimes(1);

    const rows = await sql<{ source: string; theme_id: string }[]>`
      SELECT source, theme_id FROM catalog_words WHERE word_id = ${freshId}
    `;
    expect(rows[0]?.source).toBe("search");
    expect(rows[0]?.theme_id).toBe(expectedTheme);
    expect(rows[0]?.theme_id.startsWith("interest-")).toBe(true);
  });

  it("uses Wiktionary for an inflected form and does not ask AI", async () => {
    const define = vi.fn(async () => null);
    setDefineDictionaryWord(define);
    setWiktionaryLookup((query) =>
      query === "zzbuyzz" ? { word: "buy", ru: ["покупать"], example: "I buy bread.", pos: "v" } : null,
    );
    const found = await request("/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "zzbuyzz" }),
    });
    expect(found.status).toBe(200);
    expect(found.body.exact).toBe(true);
    expect(found.body.corrected).toBe(true);
    expect(found.body.added).toBe(false);
    expect(found.body.hits.some((hit) => hit.en === "buy" || hit.id === "buy")).toBe(true);
    expect(found.body.hits.every((hit) => hit.source == null)).toBe(true);
    expect(define).not.toHaveBeenCalled();
    setWiktionaryLookup(null);
  });

  it("files one Wiktionary card when the lemma is not in the catalog", async () => {
    const define = vi.fn(async () => null);
    setDefineDictionaryWord(define);
    setWiktionaryLookup((query) =>
      query === "lookupwikiword"
        ? { word: "lookupwikiword", ru: ["словарное слово"], example: "A lookupwikiword sat.", pos: "n" }
        : null,
    );
    try {
      const created = await request("/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "lookupwikiword" }),
      });
      expect(created.status).toBe(200);
      expect(created.body.added).toBe(true);
      expect(created.body.exact).toBe(true);
      expect(created.body.corrected).toBe(false);
      expect(created.body.hits[0]).toMatchObject({
        id: "lookupwikiword",
        ru: ["словарное слово"],
        source: "Викисловарь, CC BY-SA",
        pos: "n",
      });
      expect(define).not.toHaveBeenCalled();
    } finally {
      setWiktionaryLookup(null);
      await unfile("lookupwikiword");
      await sql`DELETE FROM catalog_words WHERE word_id = 'lookupwikiword'`;
    }
  });

  it("lists every catalog theme, including when the gloss differs", async () => {
    const tail = await request("/dictionary?q=tail");
    const hit = tail.body.hits.find((item) => item.id === "tail");
    expect(hit?.themes).toEqual([
      { id: "body", title: "Тело" },
      { id: "animals", title: "Животные" },
    ]);
    expect(hit?.themeId).toBe("body");
    expect(hit?.themeTitle).toBe("Тело");

    const cock = await request("/dictionary?q=cock");
    const both = cock.body.hits.find((item) => item.id === "cock");
    expect(both?.themes).toEqual([
      { id: "body", title: "Тело" },
      { id: "animals", title: "Животные" },
    ]);
    expect(both?.themeId).toBe("body");
    expect(both?.themeTitle).toBe("Тело");
    expect(both?.ru).toEqual(["член", "петух"]);
    expect(dictionary.getTheme("animals")?.words.find((word) => word.id === "cock")?.ru).toEqual(["петух"]);
    expect(dictionary.getTheme("body")?.words.find((word) => word.id === "cock")?.ru).toEqual(["член"]);

    const seal = await request("/dictionary?q=seal");
    const split = seal.body.hits.find((item) => item.id === "seal");
    expect(split?.themes).toEqual([
      { id: "animals", title: "Животные" },
      { id: "verbs", title: "Действия" },
      { id: "supplies", title: "Канцелярия" },
    ]);
    expect(split?.ru).toEqual(["тюлень", "запечатывать", "печать"]);
    expect(dictionary.getTheme("animals")?.words.find((word) => word.id === "seal")?.ru).toEqual(["тюлень"]);
    expect(dictionary.getTheme("verbs")?.words.find((word) => word.id === "seal")?.ru).toEqual(["запечатывать"]);
    expect(dictionary.getTheme("supplies")?.words.find((word) => word.id === "seal")?.ru).toEqual(["печать"]);

    const bat = await request("/dictionary?q=bat");
    const club = bat.body.hits.find((item) => item.id === "bat");
    expect(club?.themes).toEqual([
      { id: "animals", title: "Животные" },
      { id: "sport", title: "Спорт" },
    ]);
    expect(club?.ru).toEqual(["летучая мышь", "нетопырь", "бита"]);
    expect(dictionary.getTheme("animals")?.words.find((word) => word.id === "bat")?.ru).toEqual(["летучая мышь", "нетопырь"]);
    expect(dictionary.getTheme("sport")?.words.find((word) => word.id === "bat")?.ru).toEqual(["бита"]);
  });

  it("leaves the catalog alone when AI does not recognize the query", async () => {
    const define = vi.fn(async () => null);
    setDefineDictionaryWord(define);
    const missed = await request("/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "zzzznotaword" }),
    });
    expect(missed.body.exact).toBe(false);
    expect(missed.body.corrected).toBe(false);
    expect(missed.body.added).toBe(false);
    expect(missed.body.hits).toEqual([]);
    expect(define).toHaveBeenCalledTimes(1);
  });

  it("adds a dictionary word to study without coins or known, then «Знаю» marks it known", async () => {
    const pet = await call<{ pet: { coins: number } }>("/pet");
    expect(pet.status).toBe(200);
    const coinsBefore = pet.body.pet.coins;

    const added = await call<{ wordId: string; studying: boolean; coinsEarned?: number }>("/dictionary/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId: "cock" }),
    });
    expect(added.status).toBe(200);
    expect(added.body).toEqual({ wordId: "cock", studying: true });
    expect(added.body.coinsEarned).toBeUndefined();

    const stored = await sql<{ word_id: string }[]>`
      SELECT word_id FROM user_study_words
      WHERE word_id = 'cock'
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(stored.map((row) => row.word_id)).toEqual(["cock"]);

    const progress = await sql<{ status: string }[]>`
      SELECT status FROM word_progress
      WHERE word_id = 'cock'
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(progress).toEqual([]);

    const coinsAfterStudy = await call<{ pet: { coins: number } }>("/pet");
    expect(coinsAfterStudy.body.pet.coins).toBe(coinsBefore);

    const listed = await request("/dictionary?q=cock");
    const hit = listed.body.hits.find((item) => item.id === "cock");
    expect(hit?.studying).toBe(true);
    expect(hit?.known).toBe(false);

    const themes = await call<{ themes: { id: string; title: string; studying: boolean; wordCount: number }[] }>(
      "/themes",
    );
    const mine = themes.body.themes.find((theme) => theme.id === "my-words");
    expect(mine).toMatchObject({ title: "Мои слова", studying: true, wordCount: 1 });

    const session = await call<{ words: { id: string; status: string }[] }>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "my-words", mode: "learn" }),
    });
    expect(session.status).toBe(200);
    expect(session.body.words.map((word) => word.id)).toContain("cock");
    expect(session.body.words.find((word) => word.id === "cock")?.status).not.toBe("known");

    const marked = await call<{ coinsEarned: number; pet: { coins: number } }>("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "cock", themeId: "body", correct: 0, wrong: 0, known: true }],
      }),
    });
    expect(marked.status).toBe(200);
    expect(marked.body.coinsEarned).toBe(PET.coinsPerKnownWord);
    expect(marked.body.pet.coins).toBe(coinsBefore + PET.coinsPerKnownWord);

    const knownRows = await sql<{ status: string }[]>`
      SELECT status FROM word_progress
      WHERE word_id = 'cock'
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(knownRows[0]?.status).toBe("known");

    const knownHit = await request("/dictionary?q=cock");
    expect(knownHit.body.hits.find((item) => item.id === "cock")?.known).toBe(true);

    const cleared = await call<{ coinsEarned: number; pet: { coins: number } }>("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "cock", themeId: "body", correct: 0, wrong: 0, known: false }],
      }),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.coinsEarned).toBe(0);
    expect(cleared.body.pet.coins).toBe(coinsBefore + PET.coinsPerKnownWord);
    const clearedRows = await sql<{ status: string }[]>`
      SELECT status FROM word_progress
      WHERE word_id = 'cock'
        AND user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
    `;
    expect(clearedRows[0]?.status).not.toBe("known");
  });
});
