import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import type { AppUser, CefrLevel, DictTheme, DictWord } from "./types.js";
import { CEFR_LEVELS } from "./types.js";
import { MY_WORDS_THEME_ID, myWordsTheme } from "./studyWords.js";

export interface UserWordRow {
  word_id: string;
  theme_id: string;
  en: string;
  ru: string[];
  example: string;
  level: string;
}

export function slugWord(en: string): string {
  return en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "word";
}

export function isCefr(value: unknown): value is CefrLevel {
  return typeof value === "string" && (CEFR_LEVELS as string[]).includes(value);
}

export async function loadUserWordRows(userId: string, language = activeLanguage()): Promise<UserWordRow[]> {
  return sql<UserWordRow[]>`
    SELECT word_id, theme_id, en, ru, example, level
    FROM user_words
    WHERE user_id = ${userId}::bigint AND language = ${language}
  `;
}

export function uniqueCatalogWordCount(rows: UserWordRow[]): number {
  const extra = new Set<string>();
  for (const row of rows) {
    if (!dictionary.words.has(row.word_id)) extra.add(row.word_id);
  }
  return dictionary.words.size + extra.size;
}

export function extrasByTheme(rows: UserWordRow[]): Map<string, DictWord[]> {
  const map = new Map<string, DictWord[]>();
  for (const row of rows) {
    if (!dictionary.getTheme(row.theme_id) || !isCefr(row.level)) continue;
    const word: DictWord = {
      id: row.word_id,
      en: row.en,
      word: row.en,
      ru: row.ru,
      example: row.example ?? "",
      level: row.level,
    };
    const list = map.get(row.theme_id) ?? [];
    list.push(word);
    map.set(row.theme_id, list);
  }
  return map;
}

export function mergeTheme(theme: DictTheme, extras: DictWord[] | undefined): DictTheme {
  if (!extras || extras.length === 0) return theme;
  const seen = new Set(theme.words.map((word) => word.id));
  const added = extras.filter((word) => !seen.has(word.id));
  if (added.length === 0) return theme;
  return { ...theme, words: [...theme.words, ...added] };
}

export async function themeForUser(user: AppUser, themeId: string): Promise<DictTheme | undefined> {
  if (themeId === MY_WORDS_THEME_ID) return myWordsTheme(user.id, user.language);
  if (themeId.startsWith("text:")) {
    const { loadTextPack } = await import("./texts.js");
    return loadTextPack(user, themeId);
  }
  const theme = dictionary.getTheme(themeId);
  if (!theme) return undefined;
  const extras = extrasByTheme(await loadUserWordRows(user.id)).get(themeId);
  return mergeTheme(theme, extras);
}

export async function findUserWord(userId: string, wordId: string): Promise<DictWord | undefined> {
  const canonical = dictionary.resolveWordId(wordId);
  const rows = await sql<UserWordRow[]>`
    SELECT word_id, theme_id, en, ru, example, level
    FROM user_words
    WHERE user_id = ${userId}::bigint AND language = ${activeLanguage()} AND word_id IN (${canonical}, ${wordId})
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !isCefr(row.level)) return undefined;
  return {
    id: row.word_id,
    en: row.en,
    word: row.en,
    ru: row.ru,
    example: row.example ?? "",
    level: row.level,
  };
}

export async function userOwnsWord(userId: string, wordId: string): Promise<boolean> {
  const canonical = dictionary.resolveWordId(wordId);
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM user_words
      WHERE user_id = ${userId}::bigint AND language = ${activeLanguage()} AND word_id IN (${canonical}, ${wordId})
    ) AS ok
  `;
  return Boolean(rows[0]?.ok);
}
