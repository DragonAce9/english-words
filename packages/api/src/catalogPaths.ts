import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { config } from "./config.js";

export interface LanguagePaths {
  language: string;
  /** Directory that holds themes/, media/, blocks.json, and word-pos.json. */
  dir: string;
  themesDir: string;
  mediaDir: string;
  blocksPath: string;
  posPath: string;
  legacy: boolean;
}

/** Catalog root. DICTIONARY_DIR still points at data/themes in existing deploys. */
export function catalogRoot(): string {
  const dir = config.dictionaryDir;
  if (basename(dir) !== "themes") return dir;
  const parent = dirname(dir);
  // data/en/themes → data
  if (/^[a-z]{2}$/.test(basename(parent))) return dirname(parent);
  return parent;
}

export function languageCatalogPaths(language: string): LanguagePaths {
  const root = catalogRoot();
  const code = language || "en";
  const dir = join(root, code);
  const themesDir = join(dir, "themes");
  const legacyThemes = join(root, "themes");
  const useLegacy = code === "en" && !existsSync(themesDir) && existsSync(legacyThemes);
  if (useLegacy) {
    console.warn(`dictionary: ${themesDir} is missing; reading legacy ${legacyThemes}`);
    return {
      language: code,
      dir: root,
      themesDir: legacyThemes,
      mediaDir: config.mediaDir,
      blocksPath: join(root, "blocks.json"),
      posPath: join(root, "word-pos.json"),
      legacy: true,
    };
  }
  return {
    language: code,
    dir,
    themesDir,
    mediaDir: join(dir, "media"),
    blocksPath: join(dir, "blocks.json"),
    posPath: join(dir, "word-pos.json"),
    legacy: false,
  };
}
