import { activeLanguage, enterLanguage } from "./catalogContext.js";
import { fileCatalogLemma } from "./catalog.js";
import type { DictWord } from "./types.js";

/**
 * Put a film or series lemma into a catalog category.
 * A word that already has a category stays there.
 * New lemmas are written into the theme file so the next import cannot leave them uncategorized.
 */
export function fileMediaLemma(word: DictWord, language = activeLanguage()): Promise<string> {
  return enterLanguage(language, async () => {
    const filed = await fileCatalogLemma(word, "media", language);
    return filed.themeId;
  });
}
