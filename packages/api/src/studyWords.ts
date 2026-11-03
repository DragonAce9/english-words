import { invalidateThemeCatalog } from "./catalogCache.js";
import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { HttpError } from "./httpError.js";
import type { AppUser, DictTheme, DictWord } from "./types.js";

/** Dictionary «Учить» words. Not a catalog theme; sessions read user_study_words. */
export const MY_WORDS_THEME_ID = "my-words";

export async function addStudyWord(user: AppUser, wordId: string): Promise<{ wordId: string; studying: boolean }> {
  const id = dictionary.resolveWordId(wordId);
  const word = dictionary.getWord(id);
  if (!word) throw new HttpError("Word not found", 404, "not_found");
  const language = user.language || activeLanguage();
  await sql`
    INSERT INTO user_study_words (user_id, language, word_id)
    VALUES (${user.id}::bigint, ${language}, ${id})
    ON CONFLICT (user_id, language, word_id) DO NOTHING
  `;
  await sql`
    INSERT INTO user_studying (user_id, language, theme_id)
    VALUES (${user.id}::bigint, ${language}, ${MY_WORDS_THEME_ID})
    ON CONFLICT (user_id, language, theme_id) DO NOTHING
  `;
  invalidateThemeCatalog(user.id);
  return { wordId: id, studying: true };
}

export async function studyWordIds(userId: string, wordIds: string[], language = activeLanguage()): Promise<Set<string>> {
  if (wordIds.length === 0) return new Set();
  const rows = await sql<{ word_id: string }[]>`
    SELECT word_id FROM user_study_words
    WHERE user_id = ${userId}::bigint AND language = ${language} AND word_id = ANY(${wordIds})
  `;
  return new Set(rows.map((row) => dictionary.resolveWordId(row.word_id)));
}

/** Personal dictionary picks. Learn sessions for «Мои слова» draw this list. */
export async function myWordsTheme(userId: string, language = activeLanguage()): Promise<DictTheme | undefined> {
  const rows = await sql<{ word_id: string }[]>`
    SELECT word_id FROM user_study_words
    WHERE user_id = ${userId}::bigint AND language = ${language}
    ORDER BY added_at ASC, word_id ASC
  `;
  const words: DictWord[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = dictionary.resolveWordId(row.word_id);
    if (seen.has(id)) continue;
    const word = dictionary.getWord(id);
    if (!word) continue;
    seen.add(id);
    words.push(word);
  }
  if (words.length === 0) return undefined;
  return {
    id: MY_WORDS_THEME_ID,
    title: "Мои слова",
    paid: false,
    blockId: "mine",
    words,
  };
}
