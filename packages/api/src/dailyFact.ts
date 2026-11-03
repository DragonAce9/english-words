import { config } from "./config.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";

export const FACT_TITLE = "Интересный факт от Моти";
const FACT_KINDS = ["catalog", "sense", "core", "form", "word", "line", "level", "release"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface DailyFact {
  day: string;
  body: string;
}

interface MediaWord {
  en: string;
  ru: string;
  packs: number;
  titles: number;
  level: string;
}

interface ReleaseFact {
  id: string;
  title: string;
  cards: number;
  core: number;
}

interface MediaStats {
  movieCount: number;
  seriesCount: number;
  titleCount: number;
  packCount: number;
  uniqueWords: number;
  coreWords: number;
  a1a2: number;
  words: MediaWord[];
  releases: ReleaseFact[];
}

export interface FactDraft {
  kind: FactKind;
  body: string;
  required: number[];
  extra: number[];
  /** Words, glosses, and examples the wording must keep. */
  anchors: string[];
  /** Ask for one sentence on where the word came from. Catalog counts stay without it. */
  origin: boolean;
}

let cached: { revision: number; stats: MediaStats } | null = null;
let notesCached: { revision: number; notes: LanguageNotes } | null = null;

/** Same spelling, but the two catalog cards are not the same meaning. */
const SENSE_SKIP = new Set([
  "as",
  "at",
  "by",
  "for",
  "of",
  "off",
  "over",
  "through",
  "no",
  "some",
  "out of",
  "mainly",
  "mean",
  "previous",
  "dancer",
  "pregnant",
  "pupil",
  "teacher",
  "stuff",
  "perform",
  "requirement",
  "fitter",
  "dishes",
  "fuck",
  "piss off",
  "pissed",
]);

/** Ends with -ly, but the piece before it is not the stem. */
const FALSE_LY = new Set([
  "early",
  "only",
  "holy",
  "ugly",
  "family",
  "reply",
  "apply",
  "supply",
  "july",
  "belly",
  "jelly",
  "rally",
  "ally",
  "rely",
  "fly",
  "comply",
  "imply",
  "multiply",
  "assembly",
  "bully",
  "lily",
]);

const SUFFIXES: { ending: string; tell: (stem: string, derived: string) => string }[] = [
  {
    ending: "ly",
    tell: (stem, derived) =>
      `«${derived}» собрано из «${stem}» и суффикса -ly. Суффикс дописывается к основе, отдельное слово для этой роли не нужно.`,
  },
  {
    ending: "ness",
    tell: (stem, derived) =>
      `«${derived}» собрано из «${stem}» и суффикса -ness. Так из признака получается название самого качества.`,
  },
  {
    ending: "ful",
    tell: (stem, derived) =>
      `«${derived}» собрано из «${stem}» и суффикса -ful. Суффикс значит «полный того, что в основе».`,
  },
  {
    ending: "less",
    tell: (stem, derived) =>
      `«${derived}» собрано из «${stem}» и суффикса -less. Суффикс значит «без того, что в основе».`,
  },
];

interface LanguageNotes {
  senses: { en: string; a: string; b: string }[];
  forms: { stem: string; derived: string; ending: string; body: string }[];
  lines: { en: string; ru: string; example: string }[];
}

function noun(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function countNoun(n: number, one: string, few: string, many: string): string {
  return `${n} ${noun(n, one, few, many)}`;
}

/** Genitive after «из»: singular only for 1, 21, 31… */
function countFrom(n: number, one: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  return `${n} ${mod10 === 1 && mod100 !== 11 ? one : many}`;
}

function prepFilms(n: number): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  const singular = mod10 === 1 && mod100 !== 11;
  return `${n} ${singular ? "фильме и сериале" : "фильмах и сериалах"}`;
}

export function moscowDay(now = new Date()): string {
  return moscowClock(now).day;
}

export function moscowClock(now = new Date()): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  return { day: `${pick("year")}-${pick("month")}-${pick("day")}`, hour };
}

function dayIndex(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, (month ?? 1) - 1, date ?? 1) / 86_400_000);
}

function digitsIn(text: string): number[] {
  return (text.replace(/A[1-6]/gi, "").match(/\d+/g) ?? []).map(Number).filter((value) => Number.isFinite(value));
}

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function rough(text: string): boolean {
  return /fuck|piss|shit|damn/i.test(text);
}

export function languageNotes(): LanguageNotes {
  if (notesCached && notesCached.revision === dictionary.revision) return notesCached.notes;

  const byEn = new Map<string, { ru: string }[]>();
  const heads = new Set<string>();
  for (const word of dictionary.words.values()) {
    const en = word.en.trim().toLowerCase();
    const ru = (word.ru[0] ?? "").trim();
    if (!en || !ru || rough(en) || rough(ru)) continue;
    heads.add(en);
    const list = byEn.get(en) ?? [];
    if (!list.some((item) => item.ru.toLowerCase() === ru.toLowerCase())) list.push({ ru });
    byEn.set(en, list);
  }

  const senses = [...byEn.entries()]
    .flatMap(([en, glosses]) => {
      if (glosses.length < 2 || SENSE_SKIP.has(en) || en.length < 3) return [];
      const [first, second] = glosses;
      const a = first?.ru ?? "";
      const b = second?.ru ?? "";
      if (!a || !b) return [];
      const al = a.toLowerCase();
      const bl = b.toLowerCase();
      if (al.includes(bl) || bl.includes(al)) return [];
      if (a.length > 32 || b.length > 32) return [];
      return [{ en, a, b }];
    })
    .sort((left, right) => left.en.localeCompare(right.en));

  const forms = [...heads]
    .flatMap((derived) => {
      const found: LanguageNotes["forms"] = [];
      for (const suffix of SUFFIXES) {
        if (!derived.endsWith(suffix.ending) || derived.length <= suffix.ending.length + 3) continue;
        if (suffix.ending === "ly" && FALSE_LY.has(derived)) continue;
        const stem = derived.slice(0, -suffix.ending.length);
        if (!heads.has(stem) || rough(stem) || rough(derived)) continue;
        found.push({ stem, derived, ending: suffix.ending, body: suffix.tell(stem, derived) });
      }
      return found;
    })
    .sort((left, right) => left.derived.localeCompare(right.derived) || left.ending.localeCompare(right.ending));

  const lines = [...dictionary.words.values()]
    .flatMap((word) => {
      const en = word.en.trim().toLowerCase();
      const ru = (word.ru[0] ?? "").trim();
      const example = (word.example ?? "").trim();
      if (en.length < 4 || !ru || example.length < 12 || example.length > 120) return [];
      if (rough(en) || rough(ru) || rough(example) || !hasWord(example, en)) return [];
      return [{ en, ru, example }];
    })
    .sort((left, right) => left.en.localeCompare(right.en) || left.example.localeCompare(right.example));

  const notes = { senses, forms, lines };
  notesCached = { revision: dictionary.revision, notes };
  return notes;
}

export function mediaStats(): MediaStats {
  if (cached && cached.revision === dictionary.revision) return cached.stats;

  const packWords = new Map<string, { en: string; ru: string; level: string; packs: Set<string>; titles: Set<string> }>();
  const releases = new Map<string, { title: string; words: Set<string> }>();
  let movieCount = 0;
  let seriesCount = 0;
  let packCount = 0;

  for (const theme of dictionary.themes.values()) {
    if (!dictionary.isMediaPack(theme)) continue;
    packCount += 1;
    const episode = theme.kind === "episode";
    const releaseId = episode ? theme.showId || theme.id : theme.id;
    const releaseTitle = (episode ? theme.showTitle || theme.title : theme.title).trim();
    if (!releases.has(releaseId)) {
      if (episode) seriesCount += 1;
      else movieCount += 1;
      releases.set(releaseId, { title: releaseTitle, words: new Set() });
    }
    const release = releases.get(releaseId)!;
    for (const word of theme.words) {
      release.words.add(word.id);
      const known = dictionary.words.get(word.id);
      const current = packWords.get(word.id) ?? {
        en: (known?.en || word.en || word.id).trim(),
        ru: (known?.ru?.[0] || word.ru?.[0] || "").trim(),
        level: known?.level || word.level,
        packs: new Set<string>(),
        titles: new Set<string>(),
      };
      current.packs.add(theme.id);
      current.titles.add(releaseId);
      packWords.set(word.id, current);
    }
  }

  const half = packCount / 2;
  const coreIds = new Set<string>();
  for (const [id, word] of packWords) {
    if (word.packs.size > half) coreIds.add(id);
  }
  const words: MediaWord[] = [...packWords.values()]
    .map((word) => ({
      en: word.en,
      ru: word.ru,
      packs: word.packs.size,
      titles: word.titles.size,
      level: word.level,
    }))
    .sort((a, b) => a.en.localeCompare(b.en) || a.ru.localeCompare(b.ru));
  const releaseFacts = [...releases.entries()]
    .map(([id, release]) => ({
      id,
      title: release.title,
      cards: release.words.size,
      core: [...release.words].filter((wordId) => coreIds.has(wordId)).length,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const stats: MediaStats = {
    movieCount,
    seriesCount,
    titleCount: movieCount + seriesCount,
    packCount,
    uniqueWords: words.length,
    coreWords: coreIds.size,
    a1a2: words.filter((word) => word.level === "A1" || word.level === "A2").length,
    words: words.map(({ en, ru, packs, titles, level }) => ({ en, ru, packs, titles, level })),
    releases: releaseFacts,
  };
  cached = { revision: dictionary.revision, stats };
  return stats;
}

function pick<T>(items: readonly T[], index: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[index % items.length];
}

export function factDraft(day: string): FactDraft {
  const stats = mediaStats();
  const kind = FACT_KINDS[dayIndex(day) % FACT_KINDS.length] ?? "catalog";
  if (stats.titleCount === 0 || stats.uniqueWords === 0) {
    return {
      kind: "catalog",
      body: "В каталоге пока нет фильмов и сериалов. Когда они появятся, Моти расскажет, сколько слов в них встречается.",
      required: [],
      extra: [],
      anchors: [],
      origin: false,
    };
  }

  if (kind === "sense") return senseDraft(day) ?? factDraftCatalog(stats);
  if (kind === "form") return formDraft(day) ?? factDraftCatalog(stats);
  if (kind === "line") return lineDraft(day) ?? factDraftCatalog(stats);

  if (kind === "catalog") {
    const body = `В ${prepFilms(stats.titleCount)} ${countNoun(stats.uniqueWords, "разное слово", "разных слова", "разных слов")}. ${stats.coreWords} из них есть больше чем в половине выпусков.`;
    return { kind, body, required: [stats.titleCount, stats.uniqueWords, stats.coreWords], extra: [], anchors: [], origin: false };
  }

  if (kind === "core") {
    const phrase =
      noun(stats.coreWords, "слово встречается", "слова встречаются", "слов встречается");
    const body = `${stats.coreWords} ${phrase} больше чем в половине из ${stats.packCount} выпусков. С этого списка и начинается обычный разговор.`;
    return { kind, body, required: [stats.coreWords, stats.packCount], extra: [], anchors: [], origin: false };
  }

  if (kind === "word") {
    const candidates = stats.words.filter((word) => word.en.length >= 4 && word.ru && word.titles > 0);
    const word = pick(candidates.length > 0 ? candidates : stats.words, dayIndex(day));
    if (!word) return factDraftCatalog(stats);
    const body = `Слово «${word.en}» — «${word.ru}». Оно есть в ${word.titles} из ${countFrom(stats.titleCount, "фильма и сериала", "фильмов и сериалов")}.`;
    return {
      kind,
      body,
      required: [word.titles, stats.titleCount],
      extra: digitsIn(`${word.en} ${word.ru}`),
      anchors: [word.en, word.ru],
      origin: true,
    };
  }

  if (kind === "level") {
    const body = `Из ${countNoun(stats.uniqueWords, "слова", "слов", "слов")} в фильмах и сериалах ${stats.a1a2} относятся к начальному уровню. Для обычного разговора хватает этой основы.`;
    return { kind, body, required: [stats.uniqueWords, stats.a1a2], extra: [], anchors: [], origin: false };
  }

  const release = pick(stats.releases, dayIndex(day));
  if (!release) return factDraftCatalog(stats);
  const cards = countNoun(release.cards, "карточка", "карточки", "карточек");
  const body =
    release.core > 0
      ? `В «${release.title}» ${cards}. ${release.core} из них уже входят в слова, которые повторяются в большинстве выпусков.`
      : `В «${release.title}» ${cards}. Ни одна из них не входит в слова, которые повторяются в большинстве выпусков.`;
  return {
    kind,
    body,
    required: release.core > 0 ? [release.cards, release.core] : [release.cards],
    extra: digitsIn(release.title),
    anchors: [release.title],
    origin: false,
  };
}

function senseDraft(day: string): FactDraft | undefined {
  const sense = pick(languageNotes().senses, dayIndex(day));
  if (!sense) return undefined;
  const body = `Одно написание «${sense.en}» в каталоге разобрано на две карточки: «${sense.a}» и «${sense.b}». Значение выбирается по роли слова во фразе, а не по буквам.`;
  return {
    kind: "sense",
    body,
    required: [],
    extra: digitsIn(`${sense.en} ${sense.a} ${sense.b}`),
    anchors: [sense.en, sense.a, sense.b],
    origin: true,
  };
}

function formDraft(day: string): FactDraft | undefined {
  const form = pick(languageNotes().forms, dayIndex(day));
  if (!form) return undefined;
  return {
    kind: "form",
    body: form.body,
    required: [],
    extra: digitsIn(`${form.stem} ${form.derived}`),
    anchors: [form.stem, form.derived, `-${form.ending}`],
    origin: true,
  };
}

function lineDraft(day: string): FactDraft | undefined {
  const line = pick(languageNotes().lines, dayIndex(day));
  if (!line) return undefined;
  const body = `Слово «${line.en}» значит «${line.ru}». В карточке пример: «${line.example}». По фразе видно, какое значение имеется в виду и где слово стоит.`;
  return {
    kind: "line",
    body,
    required: [],
    extra: digitsIn(`${line.en} ${line.ru} ${line.example}`),
    anchors: [line.en, line.ru, line.example],
    origin: true,
  };
}

function factDraftCatalog(stats: MediaStats): FactDraft {
  const body = `В ${prepFilms(stats.titleCount)} ${countNoun(stats.uniqueWords, "разное слово", "разных слова", "разных слов")}. ${stats.coreWords} из них есть больше чем в половине выпусков.`;
  return {
    kind: "catalog",
    body,
    required: [stats.titleCount, stats.uniqueWords, stats.coreWords],
    extra: [],
    anchors: [],
    origin: false,
  };
}

export function acceptFactText(
  text: string,
  required: readonly number[],
  extra: readonly number[] = [],
  anchors: readonly string[] = [],
): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 40 || clean.length > 750) return false;
  if (/нейросет|искусственн|\bии\b|gemini|chatgpt|языковая модель/i.test(clean)) return false;
  const haystack = clean.toLowerCase();
  if (anchors.some((anchor) => anchor.trim() && !haystack.includes(anchor.trim().toLowerCase()))) return false;
  const found: string[] = clean.replace(/A[1-6]/gi, "").match(/\d+/g) ?? [];
  const allowed = new Set([...required, ...extra].map(String));
  if (found.some((value) => !allowed.has(value))) return false;
  return required.every((value) => found.includes(String(value)));
}

export function factChannelMessage(body: string): string {
  return `${FACT_TITLE}\n\n${body}`;
}

/** First channel post: who Moti is, what this channel is for, and which bot to open. */
export function channelWelcomeMessage(): string {
  const bot = config.botUsername || "YOUR_BOT_USERNAME";
  return [
    "Привет! Я Моти.",
    "",
    "Я живу в приложении, где учат английские слова: по темам, по фильмам и сериалам и по своим текстам. За каждое новое слово мне достаются монеты — ими меня кормят и развлекают.",
    "",
    "В этом канале я каждый день буду оставлять один короткий факт: про слово из каталога, фразу из фильма или про то, как устроен наш словарь.",
    "",
    `Учиться и заботиться обо мне можно в боте @${bot}. Напиши ему /start и открой приложение.`,
  ].join("\n");
}

/** Tests must not clear the live channel's welcome mark. */
function welcomePostId(): string {
  return process.env.VITEST ? "welcome-test" : "welcome";
}

async function publishChannelWelcome(send: (text: string) => Promise<void>): Promise<void> {
  const id = welcomePostId();
  const claimed = await sql<{ id: string }[]>`
    INSERT INTO channel_posts (id)
    VALUES (${id})
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  if (!claimed[0]) return;
  try {
    await send(channelWelcomeMessage());
  } catch (error) {
    await sql`DELETE FROM channel_posts WHERE id = ${id}`;
    throw error;
  }
  console.info("channel welcome posted");
}

interface FactRow {
  body: string;
  kind: string;
  polished: boolean;
  polish_attempts: number;
  posted_at: Date | null;
}

async function readFact(day: string): Promise<FactRow | undefined> {
  const rows = await sql<FactRow[]>`
    SELECT body, kind, polished, polish_attempts, posted_at
    FROM daily_facts
    WHERE day = ${day}::date
  `;
  return rows[0];
}

export async function ensureDailyFact(day = moscowDay()): Promise<FactRow> {
  const existing = await readFact(day);
  if (existing) return existing;
  const draft = factDraft(day);
  await sql`
    INSERT INTO daily_facts (day, kind, body)
    VALUES (${day}::date, ${draft.kind}, ${draft.body})
    ON CONFLICT (day) DO NOTHING
  `;
  const row = await readFact(day);
  if (!row) throw new Error("daily fact was not stored");
  return row;
}

export async function loadUnlockedFact(userId: string, now = new Date()): Promise<DailyFact | null> {
  const day = moscowDay(now);
  const rows = await sql<{ body: string }[]>`
    SELECT f.body
    FROM user_fact_unlocks u
    JOIN daily_facts f ON f.day = u.day
    WHERE u.user_id = ${userId}::bigint AND u.day = ${day}::date
  `;
  const body = rows[0]?.body;
  return body ? { day, body } : null;
}

export async function unlockDailyFact(userId: string, now = new Date()): Promise<DailyFact> {
  const day = moscowDay(now);
  await ensureDailyFact(day);
  await sql`
    INSERT INTO user_fact_unlocks (user_id, day)
    VALUES (${userId}::bigint, ${day}::date)
    ON CONFLICT DO NOTHING
  `;
  const fact = await loadUnlockedFact(userId, now);
  if (!fact) throw new Error("daily fact was not unlocked");
  return fact;
}

function mentionsOrigin(text: string): boolean {
  return /происхо|восход|заимств|родствен|латин|греч|древне|старо|француз|немец|скандинав|норман|англосакс|кельт|итальян|испан|нидерланд|голланд|индоевроп|неясн/i.test(
    text,
  );
}

function factInstruction(draft: FactDraft): string {
  const shared =
    "Оставь каждое число из required цифрами, как в черновике. Каждую строку из anchors сохрани дословно. " +
    "Не добавляй других чисел. Не упоминай нейросеть, ИИ и то, что текст кто-то сгенерировал. Верни JSON {\"text\": \"...\"}.";
  if (!draft.origin) {
    return (
      "Перепиши черновик коротким фактом по-русски, 2 или 3 предложения, от лица приложения про английские слова. " +
      "Не добавляй происхождение слова. " +
      shared
    );
  }
  return (
    "Перепиши черновик коротким фактом по-русски, 3 предложения, от лица приложения про английские слова. " +
    "Добавь одно предложение о происхождении главного английского слова: из какого языка или от какого слова оно пришло. " +
    "Без годов, веков и любых новых чисел. Если происхождение ненадёжно, напиши, что точное происхождение неясно, и не выдумывай историю. " +
    shared
  );
}
async function writeFactText(draft: FactDraft): Promise<string | null> {
  if (!config.geminiApiKey || process.env.VITEST) return null;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: factInstruction(draft) }] },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify({ draft: draft.body, required: draft.required, anchors: draft.anchors, origin: draft.origin }) }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { text: { type: "STRING" } },
          required: ["text"],
        },
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`fact text failed HTTP ${response.status} ${detail.slice(0, 160)}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  const parsed = JSON.parse(content) as { text?: unknown };
  return typeof parsed.text === "string" ? parsed.text.trim() : null;
}

export async function tryPolishDailyFact(day = moscowDay()): Promise<void> {
  if (process.env.VITEST || !config.geminiApiKey) return;
  const claimed = await sql<FactRow[]>`
    UPDATE daily_facts
    SET polish_attempts = polish_attempts + 1
    WHERE day = ${day}::date AND polished = false AND polish_attempts < 3
    RETURNING body, kind, polished, polish_attempts, posted_at
  `;
  const row = claimed[0];
  if (!row) return;
  const draft = factDraft(day);
  try {
    const text = await writeFactText(draft);
    if (text && acceptFactText(text, draft.required, draft.extra, draft.anchors) && (!draft.origin || mentionsOrigin(text))) {
      await sql`
        UPDATE daily_facts
        SET body = ${text}, polished = true
        WHERE day = ${day}::date
      `;
      return;
    }
    console.error("daily fact polish rejected");
  } catch (error) {
    console.error("daily fact polish failed", error instanceof Error ? error.message : error);
  }
  if (row.polish_attempts >= 3) {
    await sql`UPDATE daily_facts SET polished = true WHERE day = ${day}::date`;
  }
}

let notedSkip = "";

export async function publishDailyFact(
  send: ((text: string) => Promise<void>) | null,
  now = new Date(),
): Promise<"posted" | "waiting" | "already" | "no-channel" | "no-sender"> {
  const { day, hour } = moscowClock(now);
  await ensureDailyFact(day);
  await tryPolishDailyFact(day);
  if (config.factChannelId && send) await publishChannelWelcome(send);
  if (hour < 10) return "waiting";
  if (!config.factChannelId) {
    if (notedSkip !== day) {
      notedSkip = day;
      console.info("daily fact: FACT_CHANNEL_ID is empty, channel post skipped");
    }
    return "no-channel";
  }
  if (!send) return "no-sender";
  const claimed = await sql<{ body: string }[]>`
    UPDATE daily_facts
    SET posted_at = now()
    WHERE day = ${day}::date AND posted_at IS NULL
    RETURNING body
  `;
  const body = claimed[0]?.body;
  if (!body) return "already";
  try {
    await send(factChannelMessage(body));
  } catch (error) {
    await sql`UPDATE daily_facts SET posted_at = NULL WHERE day = ${day}::date`;
    throw error;
  }
  console.info(`daily fact posted for ${day}`);
  return "posted";
}

export function startDailyFacts(send: ((text: string) => Promise<void>) | null): () => void {
  const tick = () => {
    publishDailyFact(send).catch((error) => {
      console.error("daily fact", error instanceof Error ? error.message : error);
    });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
