import { canLearnTheme, claimFreeMedia, isMediaTheme } from "./access.js";
import { invalidateThemeCatalog } from "./catalogCache.js";
import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { HttpError } from "./httpError.js";
import { MY_WORDS_THEME_ID } from "./studyWords.js";
import { loadTextPack, parseTextThemeId } from "./texts.js";
import type { AppUser } from "./types.js";

export async function enrollStudying(user: AppUser, themeId: string): Promise<void> {
  try {
    await enrollStudyingNow(user, themeId);
  } finally {
    invalidateThemeCatalog(user.id);
  }
}

async function enrollStudyingNow(user: AppUser, themeId: string): Promise<void> {
  const language = user.language || activeLanguage();
  if (themeId === MY_WORDS_THEME_ID) {
    await sql`
      INSERT INTO user_studying (user_id, language, theme_id)
      VALUES (${user.id}::bigint, ${language}, ${themeId})
      ON CONFLICT (user_id, language, theme_id) DO NOTHING
    `;
    return;
  }
  let theme = dictionary.getTheme(themeId);
  if (parseTextThemeId(themeId)) {
    theme = await loadTextPack(user, themeId);
    if (!theme) throw new HttpError("Text not found", 404, "not_found");
  } else if (!theme) return;
  if (isMediaTheme(theme) && !(await claimFreeMedia(user, theme))) return;
  if (!canLearnTheme(theme, user)) return;
  await sql`
    INSERT INTO user_studying (user_id, language, theme_id)
    VALUES (${user.id}::bigint, ${language}, ${themeId})
    ON CONFLICT (user_id, language, theme_id) DO NOTHING
  `;
}

export async function listStudyingIds(userId: string, language = activeLanguage()): Promise<Set<string>> {
  const rows = await sql<{ theme_id: string }[]>`
    SELECT theme_id
    FROM user_studying
    WHERE user_id = ${userId}::bigint AND language = ${language}
  `;
  return new Set(rows.map((row) => row.theme_id));
}

export async function enrollStudyingMany(user: AppUser, themeIds: string[]): Promise<void> {
  for (const id of [...new Set(themeIds)]) await enrollStudying(user, id);
}

export async function unenrollStudying(user: AppUser, themeIds: string[]): Promise<void> {
  const ids = [
    ...new Set(themeIds.filter((id) => id === MY_WORDS_THEME_ID || dictionary.getTheme(id) || parseTextThemeId(id))),
  ];
  if (ids.length === 0) return;
  await sql`
    DELETE FROM user_studying
    WHERE user_id = ${user.id}::bigint AND language = ${user.language || activeLanguage()} AND theme_id IN ${sql(ids)}
  `;
  invalidateThemeCatalog(user.id);
}
