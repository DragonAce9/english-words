import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { targetHead } from "./languages.js";
import { dictionary } from "./dictionary.js";
import { pick, shuffle } from "./shuffle.js";
import { HttpError } from "./httpError.js";
import { loadRecallStates, openScopedTheme, selectRecallWords, utcDay } from "./recall.js";
import { shortSubtitleLine } from "./subtitleLine.js";
import { enrollStudying } from "./studying.js";
import type {
  AppUser,
  CefrLevel,
  DictTheme,
  DictWord,
  MatchPair,
  McChoice,
  SessionMode,
  SessionResponse,
  SessionWord,
  WordStatus,
} from "./types.js";

export const SESSION_MAX = 20;
const MATCH_ROUND_SIZE = 6;
const MATCH_ROUND_COUNT = 4;

export { HttpError } from "./httpError.js";

function presentExamples(theme: DictTheme, words: SessionWord[]): SessionWord[] {
  if (theme.kind !== "movie" && theme.kind !== "episode") return words;
  return words.map((word) => {
    const example = shortSubtitleLine(word.example, targetHead(word));
    return example === word.example ? word : { ...word, example };
  });
}

function toSessionWord(word: DictWord, status: SessionWord["status"]): SessionWord {
  const head = targetHead(word);
  return {
    id: word.id,
    word: head,
    en: word.en || head,
    ru: word.ru,
    example: word.example,
    level: word.level,
    pos: word.pos,
    gender: word.gender,
    wordCyrillic: word.wordCyrillic,
    source: word.source,
    status,
  };
}

function selectWords(
  theme: DictTheme,
  statuses: Map<string, WordStatus>,
  level: CefrLevel | null,
): SessionWord[] {
  const pool = level ? theme.words.filter((word) => word.level === level) : theme.words;
  const unknown = pool
    .filter((word) => statuses.get(word.id) !== "known")
    .map((word) => toSessionWord(word, statuses.get(word.id) ?? "new"));
  if (unknown.length <= SESSION_MAX) return unknown;
  if (theme.id === "numbers") return unknown.slice(0, SESSION_MAX);
  return pick(unknown, SESSION_MAX);
}

function buildChoices(words: SessionWord[]): McChoice[] {
  const choices: McChoice[] = [];
  for (const word of words) {
    const ruPool = words.filter((item) => item.id !== word.id).flatMap((item) => item.ru);
    const head = targetHead(word);
    const enPool = words.filter((item) => item.id !== word.id).map((item) => targetHead(item));
    const ruAnswer = word.ru[0];
    const ruOptions = [ruAnswer, ...pick(ruPool.filter((item) => item !== ruAnswer), 3)];
    while (ruOptions.length < 4) ruOptions.push(ruAnswer);
    const enOptions = [head, ...pick(enPool.filter((item) => item !== head), 3)];
    while (enOptions.length < 4) enOptions.push(head);
    choices.push({
      wordId: word.id,
      direction: "en-ru",
      options: shuffle(ruOptions).slice(0, 4),
      answer: ruAnswer,
    });
    choices.push({
      wordId: word.id,
      direction: "ru-en",
      options: shuffle(enOptions).slice(0, 4),
      answer: head,
    });
  }
  return choices;
}

function buildMatchRounds(words: SessionWord[]): MatchPair[][] {
  const pairs: MatchPair[] = words.map((word) => {
    const head = targetHead(word);
    return {
      id: word.id,
      word: head,
      en: head,
      ru: word.ru[0],
    };
  });
  if (pairs.length === 0) return [];

  const size = Math.min(MATCH_ROUND_SIZE, pairs.length);
  const rounds: MatchPair[][] = [];
  const shuffled = shuffle(pairs);
  for (let i = 0; i < shuffled.length; i += size) {
    const chunk = shuffled.slice(i, i + size);
    if (chunk.length >= 2) rounds.push(chunk);
    else if (rounds.length > 0) rounds[rounds.length - 1].push(...chunk);
    else rounds.push(chunk);
  }

  while (rounds.length < MATCH_ROUND_COUNT && pairs.length >= 2) {
    rounds.push(pick(pairs, size));
  }
  return rounds;
}

export async function createSession(
  user: AppUser,
  themeId: string,
  mode: SessionMode,
  level: CefrLevel | null = null,
  categoryId: string | null = null,
  today: string = utcDay(),
): Promise<SessionResponse> {
  const theme = await openScopedTheme(user, themeId, level, categoryId);

  if (mode === "control" || mode === "review") {
    const states = await loadRecallStates(user.id, theme.words);
    const words = selectRecallWords(theme.words, states, level, today, mode);
    await enrollStudying(user, theme.id);
    return {
      themeId: theme.id,
      mode,
      level,
      categoryId,
      words: presentExamples(theme, words),
      choices: [],
      matchRounds: [],
    };
  }

  const rows = await sql<{ word_id: string; status: WordStatus }[]>`
    SELECT word_id, status
    FROM word_progress
    WHERE user_id = ${user.id} AND language = ${activeLanguage()}
  `;
  const inTheme = new Set(theme.words.map((word) => word.id));
  const statuses = new Map<string, WordStatus>();
  for (const row of rows) {
    const wordId = dictionary.resolveWordId(row.word_id);
    if (!inTheme.has(wordId)) continue;
    const prev = statuses.get(wordId);
    statuses.set(wordId, prev === "known" || row.status === "known" ? "known" : row.status);
  }
  const words = selectWords(theme, statuses, level);
  if (words.length === 0) {
    throw new HttpError("No words left for this level", 400, "empty_level");
  }

  await enrollStudying(user, theme.id);

  return {
    themeId: theme.id,
    mode,
    level,
    categoryId,
    words: presentExamples(theme, words),
    choices: buildChoices(words),
    matchRounds: buildMatchRounds(words),
  };
}
