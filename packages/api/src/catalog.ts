import { activeLanguage } from "./catalogContext.js";
import { dictionary } from "./dictionary.js";
import { sql } from "./db.js";
import { themeForMediaWord } from "./interests.js";
import { appendThemeWord } from "./themeFile.js";
import type { CefrLevel, DictWord } from "./types.js";

type CatalogSource = "text" | "media" | "search";

interface CatalogRow {
  word_id: string;
  theme_id: string;
  en: string;
  ru: string[];
  example: string;
  level: CefrLevel;
}

function asWord(row: CatalogRow): DictWord {
  return {
    id: row.word_id,
    en: row.en,
    word: row.en,
    ru: row.ru,
    example: row.example ?? "",
    level: row.level,
  };
}

/** Insert a lemma into the shared catalog and the in-memory category. */
export async function publishCatalogWord(
  word: DictWord,
  themeId: string,
  source: CatalogSource,
  language = activeLanguage(),
): Promise<{ inserted: boolean; themeId: string }> {
  const homeId = dictionary.resolveCatalogThemeId(themeId);
  const inserted = await sql<{ word_id: string }[]>`
    INSERT INTO catalog_words (word_id, theme_id, en, ru, example, level, source, language)
    VALUES (
      ${word.id},
      ${homeId},
      ${word.en},
      ${word.ru},
      ${word.example ?? ""},
      ${word.level},
      ${source},
      ${language}
    )
    ON CONFLICT (language, word_id) DO NOTHING
    RETURNING word_id
  `;
  if (inserted.length === 0) {
    const existing = await sql<{ theme_id: string }[]>`
      SELECT theme_id FROM catalog_words WHERE word_id = ${word.id} AND language = ${language}
    `;
    const stored = existing[0]?.theme_id ?? homeId;
    const chosen = stored === "general" && homeId !== "general" ? homeId : stored;
    if (chosen !== stored) {
      await sql`UPDATE catalog_words SET theme_id = ${chosen} WHERE word_id = ${word.id} AND language = ${language}`;
    }
    const adopted = dictionary.adopt(word, chosen);
    return { inserted: false, themeId: adopted.themeId };
  }
  const adopted = dictionary.adopt(word, homeId);
  return { inserted: true, themeId: adopted.themeId };
}

/**
 * File a new lemma the way film import does.
 * A word that already belongs to a theme is left there; the theme file is not rewritten.
 */
export async function fileCatalogLemma(
  word: DictWord,
  source: CatalogSource,
  language = activeLanguage(),
): Promise<{ inserted: boolean; themeId: string }> {
  const already = dictionary.catalogThemesFor(word.id);
  if (already.length > 0) {
    try {
      return await publishCatalogWord(word, already[0].id, source, language);
    } catch (error) {
      console.error(`catalog: ${word.id} is in ${already[0].id}; database update skipped`);
      console.error(error);
      return { inserted: false, themeId: already[0].id };
    }
  }
  let themeId = themeForMediaWord(word);
  dictionary.adopt(word, themeId);
  themeId = await appendThemeWord(themeId, word, language);
  const landed = dictionary.catalogThemeIdFor(word.id) ?? themeId;
  try {
    return await publishCatalogWord(word, landed, source, language);
  } catch (error) {
    console.error(`catalog: ${word.id} is in ${landed}; database update skipped`);
    console.error(error);
    return { inserted: false, themeId: landed };
  }
}

async function fileMediaWords(orphans: DictWord[]): Promise<void> {
  let filed = 0;
  for (const word of orphans) {
    let themeId = themeForMediaWord(word);
    try {
      themeId = await appendThemeWord(themeId, word, activeLanguage());
    } catch (error) {
      console.error(`catalog: could not write ${word.id} into ${themeId}`, error);
    }
    await publishCatalogWord(word, themeId, "media", activeLanguage());
    filed += 1;
  }
  console.info(`catalog: filed ${filed} film words into categories`);
}

/** Lemmas that exist only in catalog_words. Words already in a theme file stay there. */
async function fileUnfiledCatalogWords(rows: CatalogRow[]): Promise<number> {
  let filed = 0;
  for (const row of rows) {
    if (dictionary.themesFor(row.word_id).length > 0) continue;
    const word = asWord(row);
    let themeId = themeForMediaWord(word);
    try {
      themeId = await appendThemeWord(themeId, word, activeLanguage());
    } catch (error) {
      console.error(`catalog: could not write ${word.id} into ${themeId}`, error);
      continue;
    }
    const landed = dictionary.catalogThemeIdFor(word.id) ?? themeId;
    if (landed !== row.theme_id) {
      await sql`UPDATE catalog_words SET theme_id = ${landed} WHERE word_id = ${word.id} AND language = ${activeLanguage()}`;
      row.theme_id = landed;
    }
    filed += 1;
  }
  return filed;
}

/** Load shared lemmas, file any that are missing from theme files, then put film-only words into categories. */
export async function loadSharedCatalog(): Promise<void> {
  const rows = await sql<CatalogRow[]>`
    SELECT word_id, theme_id, en, ru, example, level
    FROM catalog_words
    WHERE language = ${activeLanguage()}
  `;
  const filed = await fileUnfiledCatalogWords(rows);
  for (const row of rows) dictionary.adopt(asWord(row), row.theme_id);
  const orphans = dictionary.uncategorizedMediaWords();
  console.info(
    `catalog: ${rows.length} shared words, ${filed} database-only lemmas filed into themes, ${orphans.length} film words without a category`,
  );
  if (orphans.length === 0) return;
  await fileMediaWords(orphans);
}
