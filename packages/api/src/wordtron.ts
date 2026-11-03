import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { catalogRoot } from "./catalogPaths.js";
import { sql } from "./db.js";
import { HttpError } from "./httpError.js";
import { dictionary } from "./dictionary.js";
import { stripArticle } from "./languages.js";
import { addStudyWord, studyWordIds } from "./studyWords.js";
import type { AppUser } from "./types.js";

export type GuessBucket = "green" | "yellow" | "red";

type StoredGuess = {
  word: string;
  rank: number | null;
  hint: boolean;
  bucket: GuessBucket;
  /** Set when an opponent played this row. */
  bot?: string | null;
};

const WORDTRON_BOTS = [
  { id: "mira", name: "Мира" },
  { id: "gleb", name: "Глеб" },
  { id: "sonya", name: "Соня" },
] as const;

type GameRow = {
  id: string;
  user_id: string;
  language: string;
  target_id: string;
  status: "playing" | "won" | "surrendered";
  guesses: StoredGuess[];
  hint_pos: boolean;
  hint_theme: boolean;
  hint_letter: boolean;
  hint_translation: boolean;
  closer_uses: number;
  attempts: number;
  hint_cost: number;
  green: number;
  yellow: number;
  red: number;
  bots: number;
  started_at: Date | string;
  finished_at: Date | string | null;
};

export type PackedTarget = {
  id: string;
  word: string;
  translation: string;
  pos: string;
  level: string;
  themeTitle: string;
  transcription: string | null;
  definition: string | null;
  origin: string | null;
  /** Vocab indexes of the top ranks, sorted ascending. */
  vocabIds: Uint16Array;
  ranks: Uint16Array;
  /** rank → vocab index + 1. 0 means empty. */
  byRank: Uint16Array;
};

export type LanguagePack = {
  words: string[];
  wordId: Map<string, number>;
  targets: Map<string, PackedTarget>;
};

export type WordtronCatalog = {
  languages: Map<string, LanguagePack>;
};

const POS_LABEL: Record<string, string> = {
  n: "существительное",
  v: "глагол",
  adj: "прилагательное",
  adv: "наречие",
};

const emptyCatalog = (): WordtronCatalog => ({ languages: new Map() });

let diskCatalog: WordtronCatalog | null = null;
let fixture: WordtronCatalog | null | undefined;

export function wordtronDir(): string {
  return join(catalogRoot(), "wordtron");
}

export function wordtronPreviewEnabled(telegramUserId: number): boolean {
  if (testerIds().has(telegramUserId)) return true;
  return config.allowDevAuth && telegramUserId === config.devTelegramUserId;
}

function testerIds(): Set<number> {
  const raw = process.env.WORDTRON_TESTER_IDS ?? "";
  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    const value = Number(part.trim());
    if (Number.isFinite(value) && value > 0) ids.add(value);
  }
  return ids;
}

export function useWordtronFixture(catalog: WordtronCatalog | null): void {
  fixture = catalog;
}

export function resetWordtronCache(): void {
  fixture = undefined;
  diskCatalog = null;
}

export async function warmWordtron(): Promise<void> {
  const started = Date.now();
  const catalog = loadDisk();
  diskCatalog = catalog;
  let count = 0;
  for (const pack of catalog.languages.values()) count += pack.targets.size;
  console.info(`wordtron loaded: ${count} targets in ${Date.now() - started}ms`);
}

function activeCatalog(): WordtronCatalog {
  if (fixture !== undefined) return fixture ?? emptyCatalog();
  if (!diskCatalog) diskCatalog = loadDisk();
  return diskCatalog;
}

function loadDisk(): WordtronCatalog {
  const root = wordtronDir();
  const catalog = emptyCatalog();
  if (!existsSync(root)) return catalog;
  for (const language of readdirSync(root)) {
    const dir = join(root, language);
    const vocabPath = join(dir, "vocab.json");
    if (!existsSync(vocabPath)) continue;
    const vocabRaw = JSON.parse(readFileSync(vocabPath, "utf8")) as { words?: unknown };
    const words = Array.isArray(vocabRaw.words) ? vocabRaw.words.filter((item): item is string => typeof item === "string") : [];
    const wordId = new Map<string, number>();
    words.forEach((word, index) => {
      if (index > 65534 || wordId.has(word)) return;
      wordId.set(word, index);
    });
    const targets = new Map<string, PackedTarget>();
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name === "vocab.json") continue;
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
      const packed = packTarget(raw, wordId, name.slice(0, -".json".length));
      if (!packed) continue;
      targets.set(packed.id, packed);
    }
    catalog.languages.set(language, { words, wordId, targets });
  }
  return catalog;
}

export function catalogFromRecords(
  language: string,
  words: string[],
  records: {
    id: string;
    word: string;
    translation: string;
    pos: string;
    level: string;
    themeTitle: string;
    ranks: Record<string, number>;
    transcription?: string;
    definition?: string;
    origin?: string;
  }[],
): WordtronCatalog {
  const wordId = new Map<string, number>();
  words.forEach((word, index) => {
    if (!wordId.has(word)) wordId.set(word, index);
  });
  const targets = new Map<string, PackedTarget>();
  for (const record of records) {
    const packed = packTarget(record, wordId, record.id);
    if (packed) targets.set(packed.id, packed);
  }
  return { languages: new Map([[language, { words, wordId, targets }]]) };
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function packTarget(raw: Record<string, unknown>, wordId: Map<string, number>, fileId: string): PackedTarget | null {
  const id = typeof raw.id === "string" && raw.id ? raw.id : fileId;
  const word = typeof raw.word === "string" ? raw.word : "";
  const ranksRaw = raw.ranks;
  if (!word || !ranksRaw || typeof ranksRaw !== "object") return null;
  const pairs: { vocabId: number; rank: number }[] = [];
  let maxRank = 0;
  for (const [neighbor, rankValue] of Object.entries(ranksRaw as Record<string, unknown>)) {
    const rank = typeof rankValue === "number" ? rankValue : Number(rankValue);
    const vocabId = wordId.get(neighbor);
    if (!Number.isInteger(rank) || rank < 1 || vocabId === undefined || vocabId > 65534) continue;
    pairs.push({ vocabId, rank });
    if (rank > maxRank) maxRank = rank;
  }
  pairs.sort((a, b) => a.vocabId - b.vocabId);
  const vocabIds = new Uint16Array(pairs.length);
  const ranks = new Uint16Array(pairs.length);
  const byRank = new Uint16Array(maxRank + 1);
  pairs.forEach((pair, index) => {
    vocabIds[index] = pair.vocabId;
    ranks[index] = pair.rank;
    byRank[pair.rank] = pair.vocabId + 1;
  });
  return {
    id: id || word,
    word,
    translation: typeof raw.translation === "string" ? raw.translation : "",
    pos: typeof raw.pos === "string" ? raw.pos : "",
    level: typeof raw.level === "string" ? raw.level : "",
    themeTitle: typeof raw.themeTitle === "string" ? raw.themeTitle : "",
    transcription: optionalText(raw.transcription),
    definition: optionalText(raw.definition),
    origin: optionalText(raw.origin),
    vocabIds,
    ranks,
    byRank,
  };
}

export function normalizeGuess(raw: string, language: string): string {
  return stripArticle(String(raw ?? ""), language);
}

export function colorBucket(rank: number | null): GuessBucket {
  if (rank == null || rank > 1500) return "red";
  if (rank <= 300) return "green";
  return "yellow";
}

/** Cost of the next «Ближе» hint. Used is how many closer hints are already on the board. */
export function closerCost(used: number): number {
  if (used <= 0) return 3;
  if (used === 1) return 5;
  return 8 + Math.max(0, used - 2) * 3;
}

export function closerAim(bestRank: number | null): number {
  if (bestRank == null || bestRank <= 0) return 1000;
  return Math.max(10, Math.round(bestRank / 2));
}

function botRoster(count: number): { id: string; name: string }[] {
  if (count === 2) return WORDTRON_BOTS.slice(0, 2).map((bot) => ({ ...bot }));
  if (count === 3) return WORDTRON_BOTS.map((bot) => ({ ...bot }));
  return [];
}

function botName(id: string | null | undefined): string | null {
  if (!id) return null;
  return WORDTRON_BOTS.find((bot) => bot.id === id)?.name ?? null;
}

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
let catalogHeads: Map<string, string> | null = null;
let catalogHeadsRevision = -1;

function lemmaHead(value: string): string {
  return (value.split(/\s*\/\s*/)[0] ?? value).toLowerCase().trim();
}

/** Catalog card for a guess lemma. Easiest single-word card; an id that matches the lemma wins. */
function catalogIdForLemma(lemma: string): string | null {
  if (!lemma || dictionary.words.size === 0) return null;
  if (catalogHeadsRevision !== dictionary.revision || !catalogHeads) {
    const heads = new Map<string, string>();
    for (const word of dictionary.words.values()) {
      const head = lemmaHead(word.en || "");
      if (!head || head.includes(" ")) continue;
      const previousId = heads.get(head);
      if (!previousId) {
        heads.set(head, word.id);
        continue;
      }
      const previous = dictionary.words.get(previousId);
      const previousExact = previousId === head;
      const nextExact = word.id === head;
      const previousRank = CEFR_ORDER.indexOf(previous?.level ?? "");
      const nextRank = CEFR_ORDER.indexOf(word.level);
      if ((nextExact && !previousExact) || (nextExact === previousExact && nextRank !== -1 && (previousRank === -1 || nextRank < previousRank))) {
        heads.set(head, word.id);
      }
    }
    catalogHeads = heads;
    catalogHeadsRevision = dictionary.revision;
  }
  return catalogHeads.get(lemma) ?? null;
}

function rankOfVocab(target: PackedTarget, vocabId: number): number | null {
  let lo = 0;
  let hi = target.vocabIds.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const id = target.vocabIds[mid]!;
    if (id === vocabId) return target.ranks[mid]!;
    if (id < vocabId) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

function languagePack(language: string): LanguagePack | undefined {
  return activeCatalog().languages.get(language);
}

function wordAtRank(pack: LanguagePack, target: PackedTarget, rank: number): string | null {
  const stored = target.byRank[rank];
  if (!stored) return null;
  return pack.words[stored - 1] ?? null;
}

export function pickCloserWord(pack: LanguagePack, target: PackedTarget, taken: Set<string>, bestRank: number | null): string | null {
  const aim = closerAim(bestRank);
  let chosen: string | null = null;
  let chosenDist = Infinity;
  let chosenRank = Infinity;
  for (let rank = 10; rank < target.byRank.length; rank += 1) {
    const word = wordAtRank(pack, target, rank);
    if (!word || word === target.word || taken.has(word)) continue;
    const dist = Math.abs(rank - aim);
    if (dist < chosenDist || (dist === chosenDist && rank < chosenRank)) {
      chosen = word;
      chosenDist = dist;
      chosenRank = rank;
    }
  }
  return chosen;
}

function targetsFor(language: string): PackedTarget[] {
  const pack = languagePack(language);
  return pack ? [...pack.targets.values()] : [];
}

function targetById(language: string, id: string): PackedTarget | undefined {
  return languagePack(language)?.targets.get(id);
}

function languageReady(language: string): boolean {
  return targetsFor(language).length > 0;
}

function requirePreview(user: AppUser): void {
  if (!wordtronPreviewEnabled(user.telegramUserId)) {
    throw new HttpError("Not found", 404, "not_found");
  }
}

function posLabel(pos: string): string {
  return POS_LABEL[pos] ?? pos;
}

function letterPattern(word: string): string {
  const chars = [...word];
  if (chars.length === 0) return "";
  return [chars[0], ...chars.slice(1).map(() => "_")].join(" ");
}

function hintCount(row: GameRow): number {
  return (
    row.closer_uses +
    Number(row.hint_pos) +
    Number(row.hint_theme) +
    Number(row.hint_letter) +
    Number(row.hint_translation)
  );
}

function attemptsPhrase(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11 ? "попытку" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "попытки" : "попыток";
  return `${count} ${noun}`;
}

export function shareLine(input: {
  status: "won" | "surrendered";
  score: number;
  hints: number;
  green: number;
  yellow: number;
  red: number;
}): string {
  const head =
    input.status === "won"
      ? `Wordtron — угадал за ${attemptsPhrase(input.score)}`
      : `Wordtron — сдался, ${attemptsPhrase(input.score)}`;
  return `${head}, ${input.hints} 💡 🟩${input.green} 🟨${input.yellow} 🟥${input.red}`;
}

function tally(guesses: StoredGuess[]): { green: number; yellow: number; red: number } {
  let green = 0;
  let yellow = 0;
  let red = 0;
  for (const guess of guesses) {
    if (guess.bucket === "green") green += 1;
    else if (guess.bucket === "yellow") yellow += 1;
    else red += 1;
  }
  return { green, yellow, red };
}

function bestRank(guesses: StoredGuess[]): number | null {
  let best: number | null = null;
  for (const guess of guesses) {
    if (guess.rank == null) continue;
    if (best == null || guess.rank < best) best = guess.rank;
  }
  return best;
}

function sortedGuesses(guesses: StoredGuess[]): StoredGuess[] {
  return [...guesses].sort((a, b) => {
    if (a.rank == null && b.rank == null) return a.word.localeCompare(b.word, "en");
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return a.rank - b.rank;
  });
}

function asGuesses(value: unknown): StoredGuess[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is StoredGuess => {
    if (!item || typeof item !== "object") return false;
    const guess = item as StoredGuess;
    return typeof guess.word === "string" && (guess.rank === null || typeof guess.rank === "number");
  }).map((guess) => ({ ...guess, bot: typeof guess.bot === "string" ? guess.bot : null }));
}

function view(row: GameRow, target: PackedTarget | undefined) {
  const guesses = sortedGuesses(asGuesses(row.guesses).map((guess, seq) => ({ ...guess, seq }))) as Array<
    StoredGuess & { seq: number }
  >;
  const score = row.attempts + row.hint_cost;
  const finished = row.status !== "playing";
  const hints = hintCount(row);
  const passport =
    finished && target
      ? {
          word: target.word,
          translation: target.translation,
          pos: target.pos,
          posLabel: posLabel(target.pos),
          transcription: target.transcription,
          definition: target.definition,
          origin: target.origin,
          wordId: target.id,
          nearest: nearestWords(row.language, target),
          shareText: shareLine({
            status: row.status === "won" ? "won" : "surrendered",
            score,
            hints,
            green: row.green,
            yellow: row.yellow,
            red: row.red,
          }),
        }
      : null;
  return {
    status: row.status,
    attempts: row.attempts,
    hintCost: row.hint_cost,
    score,
    closerUses: row.closer_uses,
    nextCloserCost: closerCost(row.closer_uses),
    hints: {
      pos: row.hint_pos && target ? posLabel(target.pos) : null,
      theme: row.hint_theme && target ? target.themeTitle : null,
      pattern: row.hint_letter && target ? letterPattern(target.word) : null,
      translation: row.hint_translation && target ? target.translation : null,
    },
    bots: row.bots ?? 0,
    opponents: botRoster(row.bots ?? 0).map((bot) => bot.name),
    guesses: guesses.map((guess) => ({
      word: guess.word,
      rank: guess.rank,
      far: guess.rank == null,
      hint: Boolean(guess.hint),
      bot: guess.bot ?? null,
      botName: botName(guess.bot),
      bucket: guess.bucket,
      seq: guess.seq,
    })),
    passport,
  };
}

async function present(user: AppUser, row: GameRow, target: PackedTarget | undefined) {
  const base = view(row, target);
  const language = user.language || row.language || "en";
  const studyIds = [...new Set(base.guesses.map((guess) => catalogIdForLemma(guess.word)).filter((id): id is string => Boolean(id)))];
  const studying = await studyWordIds(user.id, studyIds, language);
  return {
    ...base,
    guesses: base.guesses.map((guess) => {
      const studyId = catalogIdForLemma(guess.word);
      return { ...guess, studyId, studying: studyId ? studying.has(studyId) : false };
    }),
  };
}

function nearestWords(language: string, target: PackedTarget): { word: string; rank: number }[] {
  const pack = languagePack(language);
  const out: { word: string; rank: number }[] = [];
  for (let rank = 2; rank <= 11 && out.length < 10; rank += 1) {
    const word = pack ? wordAtRank(pack, target, rank) : null;
    if (word && word !== target.word) out.push({ word, rank });
  }
  return out;
}

async function statsFor(userId: string, language: string) {
  const rows = await sql<
    { played: number; solved: number; average_attempts: string | null; best_score: number | null; average_hints: string | null }[]
  >`
    SELECT
      count(*) FILTER (WHERE status IN ('won', 'surrendered'))::int AS played,
      count(*) FILTER (WHERE status = 'won')::int AS solved,
      round(avg(attempts) FILTER (WHERE status = 'won')::numeric, 1)::text AS average_attempts,
      min(attempts + hint_cost) FILTER (WHERE status = 'won')::int AS best_score,
      round(avg(
        closer_uses
        + hint_pos::int
        + hint_theme::int
        + hint_letter::int
        + hint_translation::int
      ) FILTER (WHERE status IN ('won', 'surrendered'))::numeric, 1)::text AS average_hints
    FROM wordtron_games
    WHERE user_id = ${userId}::bigint AND language = ${language}
  `;
  const row = rows[0];
  return {
    played: row?.played ?? 0,
    solved: row?.solved ?? 0,
    averageAttempts: row?.average_attempts == null ? null : Number(row.average_attempts),
    bestScore: row?.best_score ?? null,
    averageHints: row?.average_hints == null ? null : Number(row.average_hints),
  };
}

async function openGame(userId: string, language: string): Promise<GameRow | null> {
  const rows = await sql<GameRow[]>`
    SELECT id::text, user_id::text, language, target_id, status, guesses,
           hint_pos, hint_theme, hint_letter, hint_translation,
           closer_uses, attempts, hint_cost, green, yellow, red, bots, started_at, finished_at
    FROM wordtron_games
    WHERE user_id = ${userId}::bigint AND language = ${language} AND status = 'playing'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  row.guesses = asGuesses(row.guesses);
  return row;
}

function themesFor(language: string): string[] {
  const titles = new Set<string>();
  for (const target of targetsFor(language)) {
    if (target.themeTitle) titles.add(target.themeTitle);
  }
  return [...titles].sort((a, b) => a.localeCompare(b, "ru"));
}

export async function wordtronState(user: AppUser) {
  requirePreview(user);
  const language = user.language || "en";
  const available = languageReady(language);
  const game = available ? await openGame(user.id, language) : null;
  const target = game ? targetById(language, game.target_id) : undefined;
  return {
    available,
    language,
    levels: ["A1", "A2", "B1", "B2"],
    themes: available ? themesFor(language) : [],
    game: game ? await present(user, game, target) : null,
    stats: await statsFor(user.id, language),
  };
}

function filterTargets(language: string, level: string | null, theme: string | null): PackedTarget[] {
  return targetsFor(language).filter((target) => {
    if (level && target.level !== level) return false;
    if (theme && target.themeTitle !== theme) return false;
    return true;
  });
}

async function chooseTarget(userId: string, language: string, pool: PackedTarget[]): Promise<PackedTarget> {
  const solved = await sql<{ target_id: string; last_solved: Date }[]>`
    SELECT target_id, max(finished_at) AS last_solved
    FROM wordtron_games
    WHERE user_id = ${userId}::bigint AND language = ${language} AND status = 'won'
    GROUP BY target_id
  `;
  const solvedAt = new Map(solved.map((row) => [row.target_id, row.last_solved]));
  const fresh = pool.filter((target) => !solvedAt.has(target.id));
  if (fresh.length > 0) return fresh[Math.floor(Math.random() * fresh.length)]!;
  let oldest = pool[0]!;
  let oldestAt = solvedAt.get(oldest.id)?.getTime() ?? 0;
  for (const target of pool) {
    const at = solvedAt.get(target.id)?.getTime() ?? 0;
    if (at < oldestAt) {
      oldest = target;
      oldestAt = at;
    }
  }
  return oldest;
}

export async function startWordtronGame(
  user: AppUser,
  input: { level?: string | null; theme?: string | null; replace?: boolean; bots?: number },
) {
  requirePreview(user);
  const language = user.language || "en";
  if (!languageReady(language)) throw new HttpError("Для этого языка игры нет", 404, "not_found");
  const level = input.level ?? null;
  const theme = input.theme ?? null;
  if (level && !["A1", "A2", "B1", "B2"].includes(level)) {
    throw new HttpError("Уровень не подходит", 400, "invalid_level");
  }
  const bots = input.bots ?? 0;
  if (bots !== 0 && bots !== 2 && bots !== 3) {
    throw new HttpError("Можно играть одному или с 2–3 ботами", 400, "invalid_bots");
  }
  const pool = filterTargets(language, level, theme);
  if (pool.length === 0) throw new HttpError("Нет слов с таким фильтром", 400, "empty_pool");
  const existing = await openGame(user.id, language);
  if (existing && !input.replace) {
    throw new HttpError("Сначала закончите текущую игру", 409, "unfinished");
  }
  const target = await chooseTarget(user.id, language, pool);
  const inserted = await sql.begin(async (tx) => {
    if (input.replace) {
      await tx`
        DELETE FROM wordtron_games
        WHERE user_id = ${user.id}::bigint AND language = ${language} AND status = 'playing'
      `;
    }
    const rows = await tx<GameRow[]>`
      INSERT INTO wordtron_games (user_id, language, target_id, status, guesses, bots)
      VALUES (${user.id}::bigint, ${language}, ${target.id}, 'playing', ${tx.json([])}, ${bots})
      RETURNING id::text, user_id::text, language, target_id, status, guesses,
                hint_pos, hint_theme, hint_letter, hint_translation,
                closer_uses, attempts, hint_cost, green, yellow, red, bots, started_at, finished_at
    `;
    return rows[0];
  });
  if (!inserted) throw new HttpError("Не удалось начать игру", 500, "start_failed");
  inserted.guesses = [];
  inserted.bots = bots;
  return { game: await present(user, inserted, target), stats: await statsFor(user.id, language) };
}

function playBots(row: GameRow, pack: LanguagePack, target: PackedTarget): void {
  for (const bot of botRoster(row.bots ?? 0)) {
    const taken = new Set(row.guesses.map((guess) => guess.word));
    const own = row.guesses.filter((guess) => guess.bot === bot.id);
    const word = pickCloserWord(pack, target, taken, bestRank(own));
    if (!word || word === target.word) continue;
    const vocabId = pack.wordId.get(word);
    const rank = vocabId === undefined ? null : rankOfVocab(target, vocabId);
    if (rank == null || rank < 10 || rank === 1) continue;
    row.guesses.push({ word, rank, hint: false, bot: bot.id, bucket: colorBucket(rank) });
  }
}

function judge(pack: LanguagePack, target: PackedTarget, word: string, taken: Set<string>) {
  if (!pack.wordId.has(word)) return { kind: "unknown" as const };
  if (taken.has(word)) return { kind: "repeat" as const };
  const vocabId = pack.wordId.get(word)!;
  const rank = rankOfVocab(target, vocabId);
  if (rank == null) return { kind: "far" as const, rank: null, bucket: "red" as const };
  if (rank === 1) return { kind: "win" as const, rank, bucket: colorBucket(rank) };
  return { kind: "rank" as const, rank, bucket: colorBucket(rank) };
}

async function saveRow(row: GameRow): Promise<void> {
  await sql`
    UPDATE wordtron_games
    SET guesses = ${sql.json(row.guesses)},
        hint_pos = ${row.hint_pos},
        hint_theme = ${row.hint_theme},
        hint_letter = ${row.hint_letter},
        hint_translation = ${row.hint_translation},
        closer_uses = ${row.closer_uses},
        attempts = ${row.attempts},
        hint_cost = ${row.hint_cost},
        green = ${row.green},
        yellow = ${row.yellow},
        red = ${row.red},
        status = ${row.status},
        finished_at = ${row.finished_at}
    WHERE id = ${row.id}::bigint
  `;
}

function applyTally(row: GameRow): void {
  const counts = tally(row.guesses);
  row.green = counts.green;
  row.yellow = counts.yellow;
  row.red = counts.red;
}

export async function guessWordtron(user: AppUser, raw: string) {
  requirePreview(user);
  const language = user.language || "en";
  const row = await openGame(user.id, language);
  if (!row) throw new HttpError("Игра не начата", 404, "no_game");
  const target = targetById(language, row.target_id);
  if (!target) throw new HttpError("Слово игры не найдено", 404, "missing_target");
  const word = normalizeGuess(raw, language);
  if (!word) throw new HttpError("Введите слово", 400, "empty");
  const pack = languagePack(language);
  if (!pack) throw new HttpError("Для этого языка игры нет", 404, "not_found");
  const taken = new Set(row.guesses.map((guess) => guess.word));
  const judged = judge(pack, target, word, taken);
  if (judged.kind === "unknown") {
    return { result: "unknown" as const, message: "не знаю такого слова", game: await present(user, row, target) };
  }
  if (judged.kind === "repeat") {
    return { result: "repeat" as const, message: "Это слово уже было", game: await present(user, row, target) };
  }
  row.guesses.push({ word, rank: judged.rank, hint: false, bot: null, bucket: judged.bucket });
  row.attempts += 1;
  if (judged.kind !== "win") playBots(row, pack, target);
  applyTally(row);
  if (judged.kind === "win") {
    row.status = "won";
    row.finished_at = new Date();
  }
  await saveRow(row);
  const message = judged.kind === "far" ? "далеко (>5000)" : judged.kind === "win" ? "Слово угадано" : String(judged.rank);
  return { result: judged.kind, message, game: await present(user, row, target), stats: await statsFor(user.id, language) };
}

export async function hintWordtron(user: AppUser, kind: string) {
  requirePreview(user);
  const language = user.language || "en";
  const row = await openGame(user.id, language);
  if (!row) throw new HttpError("Игра не начата", 404, "no_game");
  const target = targetById(language, row.target_id);
  if (!target) throw new HttpError("Слово игры не найдено", 404, "missing_target");
  if (kind === "pos" || kind === "theme" || kind === "letter" || kind === "translation") {
    const flag =
      kind === "pos" ? "hint_pos" : kind === "theme" ? "hint_theme" : kind === "letter" ? "hint_letter" : "hint_translation";
    if (row[flag]) throw new HttpError("Эта подсказка уже была", 400, "hint_used");
    const cost = kind === "pos" ? 2 : kind === "theme" ? 3 : kind === "letter" ? 5 : 10;
    row[flag] = true;
    row.hint_cost += cost;
    await saveRow(row);
    return { result: "hint" as const, game: await present(user, row, target), stats: await statsFor(user.id, language) };
  }
  if (kind !== "closer") throw new HttpError("Неизвестная подсказка", 400, "bad_hint");
  const pack = languagePack(language);
  if (!pack) throw new HttpError("Для этого языка игры нет", 404, "not_found");
  const taken = new Set(row.guesses.map((guess) => guess.word));
  const word = pickCloserWord(pack, target, taken, bestRank(row.guesses.filter((guess) => !guess.bot)));
  if (!word) throw new HttpError("Ближе некуда", 400, "no_closer");
  const vocabId = pack.wordId.get(word);
  const rank = vocabId === undefined ? null : rankOfVocab(target, vocabId);
  if (rank == null || rank < 10) throw new HttpError("Ближе некуда", 400, "no_closer");
  const cost = closerCost(row.closer_uses);
  row.closer_uses += 1;
  row.hint_cost += cost;
  row.guesses.push({ word, rank, hint: true, bucket: colorBucket(rank) });
  applyTally(row);
  await saveRow(row);
  return { result: "hint" as const, game: await present(user, row, target), stats: await statsFor(user.id, language) };
}

export async function surrenderWordtron(user: AppUser) {
  requirePreview(user);
  const language = user.language || "en";
  const row = await openGame(user.id, language);
  if (!row) throw new HttpError("Игра не начата", 404, "no_game");
  const target = targetById(language, row.target_id);
  row.status = "surrendered";
  row.finished_at = new Date();
  await saveRow(row);
  return { game: await present(user, row, target), stats: await statsFor(user.id, language) };
}

export async function studyWordtronGuess(user: AppUser, raw: string) {
  requirePreview(user);
  const language = user.language || "en";
  const word = normalizeGuess(raw, language);
  if (!word) throw new HttpError("Введите слово", 400, "empty");
  const studyId = catalogIdForLemma(word);
  if (!studyId) throw new HttpError("Этого слова нет в каталоге", 404, "not_in_catalog");
  const already = (await studyWordIds(user.id, [studyId], language)).has(studyId);
  const saved = await addStudyWord(user, studyId);
  return { word, wordId: saved.wordId, studying: true, already };
}
