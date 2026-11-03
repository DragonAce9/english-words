import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { activeLanguage } from "./catalogContext.js";
import { languageCatalogPaths } from "./catalogPaths.js";
import { dictionary } from "./dictionary.js";
import {
  CATEGORY_WORD_LIMIT,
  classifyInterest,
  INTEREST_OTHER_ID,
  INTEREST_OTHER_TITLE,
  interestCategory,
  interestTag,
  pickInterestChild,
} from "./interests.js";
import type { CefrLevel, DictBlock, DictTheme, DictWord } from "./types.js";
import { CEFR_LEVELS } from "./types.js";

export interface ThemeFile {
  id: string;
  title: string;
  paid: boolean;
  words: DictWord[];
  blockId: string;
}

export function themePath(themeId: string, language = activeLanguage()): string {
  return join(languageCatalogPaths(language).themesDir, `${themeId}.json`);
}

export function blocksPath(language = activeLanguage()): string {
  return languageCatalogPaths(language).blocksPath;
}

export async function readThemeFile(themeId: string, language = activeLanguage()): Promise<ThemeFile | null> {
  try {
    const parsed = JSON.parse(await readFile(themePath(themeId, language), "utf8")) as ThemeFile;
    if (!parsed.id || !Array.isArray(parsed.words)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeThemeFile(theme: ThemeFile, language = activeLanguage()): Promise<void> {
  const body = {
    id: theme.id,
    title: theme.title,
    paid: theme.paid,
    words: theme.words,
    blockId: theme.blockId,
  };
  await writeFile(themePath(theme.id, language), `${JSON.stringify(body, null, 2)}\n`);
}

function rememberTheme(theme: ThemeFile): void {
  const blockId = theme.blockId || "other";
  const next: DictTheme = {
    id: theme.id,
    title: theme.title,
    paid: theme.paid,
    blockId,
    words: theme.words,
  };
  dictionary.themes.set(theme.id, next);
  for (const word of theme.words) {
    if (!dictionary.words.has(word.id)) dictionary.words.set(word.id, { ...word });
    const themes = dictionary.wordThemes.get(word.id) ?? [];
    if (!themes.includes(theme.id)) themes.push(theme.id);
    dictionary.wordThemes.set(word.id, themes);
  }
}

function forgetTheme(themeId: string): void {
  const theme = dictionary.themes.get(themeId);
  dictionary.themes.delete(themeId);
  for (const word of theme?.words ?? []) {
    const themes = (dictionary.wordThemes.get(word.id) ?? []).filter((id) => id !== themeId);
    if (themes.length === 0) dictionary.wordThemes.delete(word.id);
    else dictionary.wordThemes.set(word.id, themes);
  }
}

async function readBlocks(language = activeLanguage()): Promise<DictBlock[]> {
  return JSON.parse(await readFile(blocksPath(language), "utf8")) as DictBlock[];
}

async function writeBlocks(blocks: DictBlock[], language = activeLanguage()): Promise<void> {
  blocks.sort((a, b) => a.order - b.order);
  await writeFile(blocksPath(language), `${JSON.stringify(blocks, null, 2)}\n`);
  dictionary.blocks.length = 0;
  dictionary.blocks.push(...blocks);
}

function levelOf(word: DictWord): CefrLevel {
  return (CEFR_LEVELS as string[]).includes(word.level) ? word.level : "B1";
}

function letterBand(words: DictWord[], title: string, idPrefix: string): ThemeFile[] {
  const sorted = [...words].sort((a, b) => a.en.localeCompare(b.en, "en"));
  if (sorted.length <= CATEGORY_WORD_LIMIT) {
    return [{ id: idPrefix, title, paid: true, blockId: idPrefix, words: sorted }];
  }
  const mid = Math.ceil(sorted.length / 2);
  const left = sorted.slice(0, mid);
  const right = sorted.slice(mid);
  const leftTo = (left[left.length - 1]?.en[0] ?? "M").toUpperCase();
  const rightFrom = (right[0]?.en[0] ?? "N").toUpperCase();
  return [
    {
      id: `${idPrefix}-a`,
      title: `${title}, A–${leftTo}`,
      paid: true,
      blockId: idPrefix,
      words: left,
    },
    {
      id: `${idPrefix}-b`,
      title: `${title}, ${rightFrom}–Z`,
      paid: true,
      blockId: idPrefix,
      words: right,
    },
  ];
}

/** Split one oversized interest theme into the catalog's tags, then by CEFR if a tag is still too big. */
export async function splitInterestTheme(theme: ThemeFile, language = activeLanguage()): Promise<void> {
  const categoryId = theme.id.startsWith("interest-") ? theme.id.slice("interest-".length) : "";
  const category = interestCategory(categoryId);
  const groups = new Map<string, { title: string; words: DictWord[] }>();
  for (const word of theme.words) {
    const match = category ? classifyInterest(word.en, word.ru) : null;
    const tagSlug = match?.categoryId === categoryId ? match.tagSlug : "other";
    const tag = category ? interestTag(categoryId, tagSlug) : undefined;
    const id = tag ? `${theme.id}-${tag.slug}` : `${theme.id}-other`;
    const title = tag?.nameRu ?? INTEREST_OTHER_TITLE;
    const bucket = groups.get(id) ?? { title, words: [] };
    bucket.words.push(word);
    groups.set(id, bucket);
  }

  const children: ThemeFile[] = [];
  for (const [id, bucket] of groups) {
    if (bucket.words.length <= CATEGORY_WORD_LIMIT) {
      children.push({ id, title: bucket.title, paid: true, blockId: theme.id, words: bucket.words });
      continue;
    }
    for (const level of CEFR_LEVELS) {
      const slice = bucket.words.filter((word) => levelOf(word) === level);
      if (slice.length === 0) continue;
      const titled = `${bucket.title} · ${level}`;
      const bandId = `${id}-${level.toLowerCase()}`;
      for (const part of letterBand(slice, titled, bandId)) {
        part.blockId = theme.id;
        children.push(part);
      }
    }
  }
  if (children.length === 0) return;

  for (const child of children) await writeThemeFile(child, language);
  await unlink(themePath(theme.id, language));
  forgetTheme(theme.id);
  for (const child of children) rememberTheme(child);

  const blocks = await readBlocks(language);
  for (const block of blocks) block.themeIds = block.themeIds.filter((id) => id !== theme.id);
  const order = (blocks.find((block) => block.id === "interests")?.order ?? 7) + 0.1;
  blocks.push({
    id: theme.id,
    title: category?.nameRu ?? theme.title,
    order,
    themeIds: children.map((child) => child.id),
  });
  await writeBlocks(blocks, language);
}

/** Add a lemma to a category file. Splits the category when it grows past 1000 words. */
export async function appendThemeWord(themeId: string, word: DictWord, language = activeLanguage()): Promise<string> {
  let theme = await readThemeFile(themeId, language);
  if (!theme) {
    const childId = pickInterestChild(themeId, word);
    if (childId) theme = await readThemeFile(childId, language);
  }
  if (!theme) throw new Error(`theme file ${themeId} is missing`);
  if (theme.words.some((item) => item.id === word.id)) return theme.id;
  theme.words.push({
    id: word.id,
    en: word.en,
    word: word.word || word.en,
    ru: word.ru,
    example: word.example ?? "",
    level: levelOf(word),
    pos: word.pos,
    gender: word.gender,
    sourceId: word.sourceId,
    source: word.source,
  });
  await writeThemeFile(theme, language);
  if (theme.words.length <= CATEGORY_WORD_LIMIT || !theme.id.startsWith("interest-")) return theme.id;
  if (theme.id === INTEREST_OTHER_ID) {
    const standIn: ThemeFile = { ...theme, id: INTEREST_OTHER_ID, title: INTEREST_OTHER_TITLE };
    await splitInterestTheme(standIn, language);
  } else {
    await splitInterestTheme(theme, language);
  }
  return dictionary.catalogThemeIdFor(word.id) ?? theme.id;
}
