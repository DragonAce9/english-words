import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { targetHead } from "./languages.js";
import { utcDay } from "./recall.js";
import { pick, shuffle } from "./shuffle.js";
import {
  CEFR_LEVELS,
  type AppUser,
  type CefrLevel,
  type DictWord,
  type MatchPair,
  type McChoice,
  type SessionResponse,
  type SessionWord,
  type WordStatus,
} from "./types.js";

export const FIRST_SESSION_WORD_COUNT = 12;
const PER_LEVEL = 2;

export interface FirstSessionSampleWord {
  id: string;
  word: string;
  ru: string[];
  level: CefrLevel;
}

export interface FirstSessionPack {
  session: SessionResponse;
  dictionaryTarget: FirstSessionSampleWord | null;
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
    status,
  };
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
  const size = Math.min(6, pairs.length);
  const rounds: MatchPair[][] = [];
  const shuffled = shuffle(pairs);
  for (let i = 0; i < shuffled.length; i += size) {
    const chunk = shuffled.slice(i, i + size);
    if (chunk.length >= 2) rounds.push(chunk);
    else if (rounds.length > 0) rounds[rounds.length - 1].push(...chunk);
    else rounds.push(chunk);
  }
  return rounds;
}

function isCleanHeadword(word: DictWord): boolean {
  const head = targetHead(word).trim();
  if (head.length < 2 || head.length > 22) return false;
  if (head.includes("/")) return false;
  return Array.isArray(word.ru) && word.ru.length > 0 && Boolean(word.ru[0]?.trim());
}

function accessibleCatalogPool(): { words: DictWord[]; fallbackThemeId: string } {
  const seen = new Set<string>();
  const free: DictWord[] = [];
  const all: DictWord[] = [];
  let fallbackThemeId = "numbers";

  for (const theme of dictionary.listThemes()) {
    if (dictionary.isMediaPack(theme) || theme.kind === "text") continue;
    if (!theme.paid && fallbackThemeId === "numbers") fallbackThemeId = theme.id;
    for (const word of theme.words) {
      if (seen.has(word.id) || !isCleanHeadword(word)) continue;
      if (!theme.paid) {
        seen.add(word.id);
        free.push(word);
      }
    }
  }

  if (free.length >= FIRST_SESSION_WORD_COUNT) {
    return { words: free, fallbackThemeId };
  }

  seen.clear();
  for (const theme of dictionary.listThemes()) {
    if (dictionary.isMediaPack(theme) || theme.kind === "text") continue;
    for (const word of theme.words) {
      if (seen.has(word.id) || !isCleanHeadword(word)) continue;
      seen.add(word.id);
      all.push(word);
    }
  }
  return { words: all, fallbackThemeId };
}

function pickAcrossLevels(pool: DictWord[], statuses: Map<string, WordStatus>): DictWord[] {
  const unknown = pool.filter((word) => statuses.get(word.id) !== "known");
  const source = unknown.length >= FIRST_SESSION_WORD_COUNT ? unknown : pool;
  const chosen: DictWord[] = [];
  const used = new Set<string>();

  for (const level of CEFR_LEVELS) {
    const bucket = source.filter((word) => word.level === level && !used.has(word.id));
    for (const word of pick(bucket, PER_LEVEL)) {
      used.add(word.id);
      chosen.push(word);
    }
  }

  if (chosen.length < FIRST_SESSION_WORD_COUNT) {
    const rest = source.filter((word) => !used.has(word.id));
    for (const word of pick(rest, FIRST_SESSION_WORD_COUNT - chosen.length)) {
      used.add(word.id);
      chosen.push(word);
    }
  }

  return chosen.sort((a, b) => CEFR_LEVELS.indexOf(a.level) - CEFR_LEVELS.indexOf(b.level));
}

function pickDictionaryTarget(pool: DictWord[], excludeIds: Set<string>): FirstSessionSampleWord | null {
  const candidates = pool.filter((word) => {
    if (excludeIds.has(word.id)) return false;
    const head = targetHead(word).trim();
    return /^[\p{L}-]{3,14}$/u.test(head);
  });
  const picked = pick(candidates.length > 0 ? candidates : pool, 1)[0];
  if (!picked) return null;
  return {
    id: picked.id,
    word: targetHead(picked),
    ru: picked.ru,
    level: picked.level,
  };
}

export async function createFirstSessionPack(user: AppUser, _today = utcDay()): Promise<FirstSessionPack> {
  const rows = await sql<{ word_id: string; status: WordStatus }[]>`
    SELECT word_id, status
    FROM word_progress
    WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()}
  `;
  const statuses = new Map<string, WordStatus>();
  for (const row of rows) {
    const wordId = dictionary.resolveWordId(row.word_id);
    const prev = statuses.get(wordId);
    statuses.set(wordId, prev === "known" || row.status === "known" ? "known" : row.status);
  }

  const { words: pool, fallbackThemeId } = accessibleCatalogPool();
  const picked = pickAcrossLevels(pool, statuses);
  const sessionWords = picked.map((word) => toSessionWord(word, statuses.get(word.id) ?? "new"));
  const exclude = new Set(sessionWords.map((word) => word.id));

  return {
    session: {
      themeId: fallbackThemeId,
      mode: "learn",
      level: null,
      categoryId: null,
      words: sessionWords,
      choices: buildChoices(sessionWords),
      matchRounds: buildMatchRounds(sessionWords),
    },
    dictionaryTarget: pickDictionaryTarget(pool, exclude),
  };
}
