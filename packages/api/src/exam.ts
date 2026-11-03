import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { targetHead } from "./languages.js";
import { dictionary } from "./dictionary.js";
import { HttpError } from "./httpError.js";
import { pick } from "./shuffle.js";
import { MY_WORDS_THEME_ID, myWordsTheme } from "./studyWords.js";
import { listStudyingIds } from "./studying.js";
import { loadTextPack } from "./texts.js";
import type { AppUser, DictTheme, DictWord, SessionWord } from "./types.js";
import { extrasByTheme, loadUserWordRows, mergeTheme } from "./userWords.js";

export const EXAM_MAX = 20;

function toSessionWord(word: DictWord): SessionWord {
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
    status: "known",
  };
}

async function themeForExam(
  user: AppUser,
  themeId: string,
  extras: Map<string, DictWord[]>,
): Promise<DictTheme | undefined> {
  if (themeId === MY_WORDS_THEME_ID) return myWordsTheme(user.id);
  if (themeId.startsWith("text:")) return loadTextPack(user, themeId);
  const theme = dictionary.getTheme(themeId);
  if (!theme) return undefined;
  return mergeTheme(theme, extras.get(themeId));
}

/** Known words from themes still listed on Изучаю. A finished theme is not on that screen. */
export async function createExam(user: AppUser): Promise<{ words: SessionWord[] }> {
  const studyingIds = await listStudyingIds(user.id, user.language);
  const knownRows = await sql<{ word_id: string }[]>`
    SELECT word_id
    FROM word_progress
    WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()} AND status = 'known'
  `;
  const known = new Set(knownRows.map((row) => dictionary.resolveWordId(row.word_id)));
  const extras = extrasByTheme(await loadUserWordRows(user.id));
  const pool = new Map<string, DictWord>();

  for (const themeId of studyingIds) {
    const theme = await themeForExam(user, themeId, extras);
    if (!theme || theme.words.length === 0) continue;
    const unique = new Map<string, DictWord>();
    for (const word of theme.words) unique.set(word.id, word);
    let knownCount = 0;
    for (const id of unique.keys()) if (known.has(id)) knownCount += 1;
    if (knownCount === 0 || knownCount === unique.size) continue;
    for (const [id, word] of unique) {
      if (known.has(id)) pool.set(id, word);
    }
  }

  if (pool.size === 0) {
    throw new HttpError("Пока нечего проверять", 400, "empty_exam");
  }

  return {
    words: pick([...pool.values()], Math.min(EXAM_MAX, pool.size)).map(toSessionWord),
  };
}
