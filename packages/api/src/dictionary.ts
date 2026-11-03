import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { isFreeCatalogTheme } from "./access.js";
import { catalogRoot, languageCatalogPaths } from "./catalogPaths.js";
import { activeLanguage } from "./catalogContext.js";
import type { CefrLevel, DictBlock, DictTheme, DictWord, LevelCounts, ThemeCategorySummary, WordGender, WordPos } from "./types.js";
import { CEFR_LEVELS } from "./types.js";

export const UNCATEGORIZED_ID = "uncategorized";
export const UNCATEGORIZED_TITLE = "Прочее";

const LEGACY_WORD_IDS: Record<string, string> = {
  "daily.wake": "wake-up",
};

const LEVEL_SET = new Set<string>(CEFR_LEVELS);
const POS_SET = new Set<string>([
  "n",
  "v",
  "adj",
  "adv",
  "numeral",
  "pronoun",
  "determiner",
  "preposition",
  "conjunction",
  "interjection",
]);

function normalizeLevel(raw: unknown): CefrLevel {
  if (typeof raw === "string" && LEVEL_SET.has(raw)) return raw as CefrLevel;
  return "B1";
}

export function canonicalizeWordId(id: string, catalog: { has(id: string): boolean }): string {
  if (catalog.has(id)) return id;
  const mapped = LEGACY_WORD_IDS[id];
  if (mapped && catalog.has(mapped)) return mapped;
  const dot = id.indexOf(".");
  if (dot > 0) {
    const stripped = id.slice(dot + 1);
    if (catalog.has(stripped)) return stripped;
  }
  return id;
}

function asGender(raw: unknown): WordGender | undefined {
  return raw === "m" || raw === "f" || raw === "n" || raw === "m/f" ? raw : undefined;
}

function completeWord(word: DictWord, pos: WordPos | undefined): DictWord {
  const raw = word as DictWord & { sourceIds?: unknown };
  const rawSource = (word as { sourceId?: unknown }).sourceId;
  const listed = typeof raw.word === "string" ? raw.word.trim() : "";
  const en = (typeof raw.en === "string" ? raw.en.trim() : "") || listed;
  const head = listed || en;
  const fromList = Array.isArray(raw.sourceIds) ? raw.sourceIds.filter((item): item is string => typeof item === "string") : [];
  const sourceId =
    typeof rawSource === "string"
      ? rawSource
      : Array.isArray(rawSource)
        ? rawSource.find((item): item is string => typeof item === "string")
        : fromList[0];
  return {
    ...word,
    en,
    word: head,
    gender: asGender(word.gender),
    sourceId,
    sourceIds: fromList.length > 0 ? fromList : undefined,
    level: normalizeLevel(word.level),
    example: word.example ?? "",
    pos: pos ?? word.pos,
  };
}

export interface CatalogTally {
  count: number;
  levels: LevelCounts;
}

export interface StaticCategory {
  id: string;
  title: string;
  wordCount: number;
  levels: LevelCounts;
}

interface WordHit {
  themeId: string;
  level: CefrLevel;
}

interface CategoryHit {
  themeId: string;
  categoryId: string;
  level: CefrLevel;
}

interface ThemeStat {
  wordCount: number;
  levels: LevelCounts;
}

interface CatalogStats {
  themes: Map<string, ThemeStat>;
  categories: Map<string, StaticCategory[]>;
  byWord: Map<string, WordHit[]>;
  byCategoryWord: Map<string, CategoryHit[]>;
}

export function categoryTallyKey(themeId: string, categoryId: string): string {
  return `${themeId}\t${categoryId}`;
}

function addTally(map: Map<string, CatalogTally>, key: string, level: CefrLevel): void {
  let tally = map.get(key);
  if (!tally) {
    tally = { count: 0, levels: emptyLevels() };
    map.set(key, tally);
  }
  tally.count += 1;
  tally.levels[level] += 1;
}

export class Dictionary {
  readonly themes = new Map<string, DictTheme>();
  readonly words = new Map<string, DictWord>();
  readonly wordThemes = new Map<string, string[]>();
  readonly blocks: DictBlock[] = [];
  /** Bumps when the in-memory catalog changes, so lemma indexes rebuild. */
  revision = 0;

  private listingPos = new Map<string, WordPos>();
  private catalogStatsCache: CatalogStats | null = null;
  private catalogStatsRevision = -1;

  constructor(readonly language = "en") {}

  async load(): Promise<void> {
    this.revision += 1;
    this.themes.clear();
    this.words.clear();
    this.wordThemes.clear();
    this.listingPos.clear();
    this.blocks.length = 0;
    const paths = languageCatalogPaths(this.language);
    await this.loadPos(paths.posPath);

    const blocksRaw = await readFile(paths.blocksPath, "utf8");
    const blocks = JSON.parse(blocksRaw) as DictBlock[];
    this.blocks.push(...blocks.sort((a, b) => a.order - b.order));

    const files = (await readdir(paths.themesDir)).filter((name) => name.endsWith(".json"));
    if (files.length === 0) {
      throw new Error(`No theme JSON files in ${paths.themesDir}`);
    }
    for (const file of files) {
      await this.ingestFile(joinPath(paths.themesDir, file), file);
    }
    if (existsSync(paths.mediaDir)) {
      const mediaFiles = (await readdir(paths.mediaDir)).filter((name) => name.endsWith(".json"));
      for (const file of mediaFiles) {
        await this.ingestFile(joinPath(paths.mediaDir, file), file, "media");
      }
    }
    this.ensureCatalogStats();
    const listed = [...this.themes.values()].reduce((sum, theme) => sum + theme.words.length, 0);
    console.info(
      `dictionary ${this.language} loaded: ${this.themes.size} themes, ${this.words.size} unique words (${listed} listings), ${this.blocks.length} blocks`,
    );
  }

  private async loadPos(path: string): Promise<void> {
    if (!existsSync(path)) return;
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && POS_SET.has(value)) this.listingPos.set(key, value as WordPos);
    }
  }

  private async ingestFile(path: string, file: string, forceBlockId?: string): Promise<void> {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as DictTheme;
    if (!parsed.id || !Array.isArray(parsed.words)) {
      throw new Error(`Invalid theme file ${file}`);
    }
    const blockId = forceBlockId || parsed.blockId || "other";
    const theme: DictTheme = {
      ...parsed,
      blockId,
      paid: blockId === "media" ? true : !isFreeCatalogTheme(parsed.id),
      words: parsed.words.map((word) =>
        completeWord(word, this.listingPos.get(`${parsed.id}\t${word.id}`)),
      ),
    };
    this.themes.set(theme.id, theme);
    for (const word of theme.words) {
      const existing = this.words.get(word.id);
      if (existing) {
        if (existing.en !== word.en) {
          console.warn(`dictionary: id ${word.id} reused for "${existing.en}" and "${word.en}"`);
        }
        // Keep the easier CEFR if the same word appears in multiple themes.
        if (CEFR_LEVELS.indexOf(word.level) < CEFR_LEVELS.indexOf(existing.level)) {
          existing.level = word.level;
        }
      } else {
        this.words.set(word.id, { ...word });
      }
      const themes = this.wordThemes.get(word.id) ?? [];
      if (!themes.includes(theme.id)) themes.push(theme.id);
      this.wordThemes.set(word.id, themes);
    }
  }

  resolveWordId(id: string): string {
    return canonicalizeWordId(id, this.words);
  }

  getWord(id: string): DictWord | undefined {
    return this.words.get(this.resolveWordId(id));
  }

  /** Replace the Russian gloss on every listing of this card. */
  setGloss(wordId: string, ru: string[]): boolean {
    const word = this.words.get(this.resolveWordId(wordId));
    const gloss = ru.map((item) => item.trim()).filter(Boolean).slice(0, 3);
    if (!word || gloss.length === 0) return false;
    word.ru = gloss;
    for (const theme of this.themes.values()) {
      for (const listing of theme.words) {
        if (listing.id === word.id) listing.ru = gloss;
      }
    }
    this.revision += 1;
    return true;
  }

  /**
   * Move a catalog listing. A film pack stays as the study list;
   * only the category card moves.
   */
  moveListing(wordId: string, fromThemeId: string, toThemeId: string): boolean {
    const id = this.resolveWordId(wordId);
    const word = this.words.get(id);
    const to = this.getTheme(toThemeId);
    if (!word || !to || this.isMediaPack(to) || to.kind === "text") return false;
    if (!to.words.some((item) => item.id === id)) to.words.push({ ...word });
    const themes = this.wordThemes.get(id) ?? [];
    if (!themes.includes(to.id)) themes.push(to.id);
    this.wordThemes.set(id, themes);
    const from = this.getTheme(fromThemeId);
    if (from && from.id !== to.id && !this.isMediaPack(from) && from.kind !== "text") {
      from.words = from.words.filter((item) => item.id !== id);
      this.wordThemes.set(
        id,
        themes.filter((themeId) => themeId !== from.id),
      );
    }
    this.revision += 1;
    return true;
  }

  themesFor(id: string): string[] {
    return this.wordThemes.get(this.resolveWordId(id)) ?? [];
  }

  /** Part of speech recorded for this card, if the catalog tagged it. */
  posFor(wordId: string): WordPos | undefined {
    const id = this.resolveWordId(wordId);
    for (const themeId of this.wordThemes.get(id) ?? []) {
      const pos = this.listingPos.get(`${themeId}\t${id}`);
      if (pos) return pos;
    }
    return this.words.get(id)?.pos;
  }

  listThemes(): DictTheme[] {
    const preferred = ["travel", "food", "daily"];
    return [...this.themes.values()].sort((a, b) => {
      if (a.id === "general") return 1;
      if (b.id === "general") return -1;
      const ai = preferred.indexOf(a.id);
      const bi = preferred.indexOf(b.id);
      if (ai === -1 && bi === -1) return a.title.localeCompare(b.title, "ru");
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  getTheme(id: string): DictTheme | undefined {
    return this.themes.get(id);
  }

  listBlocks(): DictBlock[] {
    return this.blocks;
  }

  isMediaPack(theme: DictTheme): boolean {
    return theme.kind === "movie" || theme.kind === "episode";
  }

  /** Catalog theme a new word may belong to. Films and text packs are not categories. */
  resolveCatalogThemeId(themeId: string): string {
    const theme = this.themes.get(themeId);
    if (theme && !this.isMediaPack(theme) && theme.kind !== "text") return theme.id;
    return "general";
  }

  /**
   * Place a word into a catalog category.
   * Returns false when the word id was already in the shared vocabulary.
   */
  adopt(word: DictWord, themeId: string): { created: boolean; themeId: string } {
    const resolvedId = this.resolveCatalogThemeId(themeId);
    const theme = this.themes.get(resolvedId);
    if (!theme) throw new Error(`catalog theme ${resolvedId} is missing`);
    const created = !this.words.has(word.id);
    if (created) this.words.set(word.id, { ...word });
    if (!theme.words.some((item) => item.id === word.id)) theme.words.push({ ...word });
    const themes = this.wordThemes.get(word.id) ?? [];
    if (!themes.includes(theme.id)) themes.push(theme.id);
    this.wordThemes.set(word.id, themes);
    this.revision += 1;
    return { created, themeId: theme.id };
  }

  /** Drop a word that was adopted at runtime. JSON listings are rebuilt by load(). */
  forget(wordId: string): void {
    if (!this.words.delete(wordId)) return;
    this.wordThemes.delete(wordId);
    for (const theme of this.themes.values()) {
      if (!theme.words.some((word) => word.id === wordId)) continue;
      theme.words = theme.words.filter((word) => word.id !== wordId);
    }
    this.revision += 1;
  }

  /** Film lemmas that are in the vocabulary but not inside any catalog category. */
  uncategorizedMediaWords(): DictWord[] {
    const seen = new Set<string>();
    const out: DictWord[] = [];
    for (const theme of this.themes.values()) {
      if (!this.isMediaPack(theme)) continue;
      for (const word of theme.words) {
        if (seen.has(word.id) || this.catalogThemeIdFor(word.id)) continue;
        seen.add(word.id);
        out.push(word);
      }
    }
    return out;
  }

  /**
   * Catalog categories that list this word, in catalog order.
   * Film packs are not categories. A different gloss in another theme still counts.
   */
  catalogThemesFor(wordId: string): DictTheme[] {
    const candidates = this.themesFor(wordId)
      .map((id) => this.themes.get(id))
      .filter((theme): theme is DictTheme => theme != null && !this.isMediaPack(theme) && theme.kind !== "text");
    const order = this.blocks.flatMap((block) => block.themeIds);
    candidates.sort((a, b) => {
      if (a.id === "general") return 1;
      if (b.id === "general") return -1;
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.title.localeCompare(b.title, "ru");
    });
    return candidates;
  }

  /**
   * Glosses from every catalog listing, in catalog order.
   * Each theme keeps its own sense; the dictionary card shows the union.
   */
  catalogGlosses(wordId: string): string[] {
    const id = this.resolveWordId(wordId);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const theme of this.catalogThemesFor(id)) {
      const listing = theme.words.find((word) => word.id === id);
      for (const item of listing?.ru ?? []) {
        const clean = item.trim();
        const key = clean.toLowerCase().replaceAll("ё", "е");
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
      }
    }
    if (out.length > 0) return out;
    return this.words.get(id)?.ru ?? [];
  }

  catalogThemeIdFor(wordId: string): string | null {
    return this.catalogThemesFor(wordId)[0]?.id ?? null;
  }

  wordsForCategory(theme: DictTheme, categoryId: string | null | undefined): DictWord[] {
    if (!categoryId) return theme.words;
    return theme.words.filter((word) => {
      const id = this.catalogThemeIdFor(word.id);
      if (categoryId === UNCATEGORIZED_ID) return id === null;
      return id === categoryId;
    });
  }

  mediaCategories(theme: DictTheme, known: Set<string>): ThemeCategorySummary[] {
    if (!this.isMediaPack(theme)) return [];
    return this.packCategories(theme, known);
  }

  packCategories(theme: DictTheme, known: Set<string>): ThemeCategorySummary[] {
    return this.categoryDrafts(theme).map((draft) => {
      const levels = emptyLevels();
      const knownByLevel = emptyLevels();
      let knownCount = 0;
      for (const word of draft.words) {
        levels[word.level] += 1;
        if (known.has(word.id)) {
          knownByLevel[word.level] += 1;
          knownCount += 1;
        }
      }
      return {
        id: draft.id,
        title: draft.title,
        wordCount: draft.words.length,
        knownCount,
        levels,
        knownByLevel,
      };
    });
  }

  /** Word count and level histogram for a catalog theme. Null when the theme is not in this dictionary. */
  themeStat(themeId: string): { wordCount: number; levels: LevelCounts } | undefined {
    const stat = this.ensureCatalogStats().themes.get(themeId);
    if (!stat) return undefined;
    return { wordCount: stat.wordCount, levels: { ...stat.levels } };
  }

  /** Category shells for a film or text pack, without the user's known counts. */
  themeCategories(themeId: string): readonly StaticCategory[] | undefined {
    return this.ensureCatalogStats().categories.get(themeId);
  }

  /**
   * Known-word counts for every theme and media category.
   * Walks the user's known set, not the whole catalog.
   */
  overlayKnown(known: Set<string>): { themes: Map<string, CatalogTally>; categories: Map<string, CatalogTally> } {
    const stats = this.ensureCatalogStats();
    const themes = new Map<string, CatalogTally>();
    const categories = new Map<string, CatalogTally>();
    for (const id of known) {
      const themeHits = stats.byWord.get(id);
      if (themeHits) {
        for (const hit of themeHits) addTally(themes, hit.themeId, hit.level);
      }
      const categoryHits = stats.byCategoryWord.get(id);
      if (categoryHits) {
        for (const hit of categoryHits) {
          addTally(categories, categoryTallyKey(hit.themeId, hit.categoryId), hit.level);
        }
      }
    }
    return { themes, categories };
  }

  private categoryDrafts(theme: DictTheme): { id: string; title: string; words: DictWord[] }[] {
    const buckets = new Map<string, { title: string; words: DictWord[] }>();
    for (const word of theme.words) {
      const id = this.catalogThemeIdFor(word.id) ?? UNCATEGORIZED_ID;
      const title = id === UNCATEGORIZED_ID ? UNCATEGORIZED_TITLE : (this.getTheme(id)?.title ?? UNCATEGORIZED_TITLE);
      const bucket = buckets.get(id) ?? { title, words: [] };
      bucket.words.push(word);
      buckets.set(id, bucket);
    }
    const order = this.blocks.flatMap((block) => block.themeIds);
    return [...buckets.entries()]
      .sort((a, b) => {
        if (a[0] === UNCATEGORIZED_ID) return 1;
        if (b[0] === UNCATEGORIZED_ID) return -1;
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return a[1].title.localeCompare(b[1].title, "ru");
      })
      .map(([id, bucket]) => ({ id, title: bucket.title, words: bucket.words }));
  }

  private ensureCatalogStats(): CatalogStats {
    if (this.catalogStatsCache && this.catalogStatsRevision === this.revision) return this.catalogStatsCache;
    const byWord = new Map<string, WordHit[]>();
    const byCategoryWord = new Map<string, CategoryHit[]>();
    const themes = new Map<string, ThemeStat>();
    const categories = new Map<string, StaticCategory[]>();
    for (const theme of this.themes.values()) {
      const levels = emptyLevels();
      for (const word of theme.words) {
        levels[word.level] += 1;
        const hit = { themeId: theme.id, level: word.level };
        const hits = byWord.get(word.id);
        if (hits) hits.push(hit);
        else byWord.set(word.id, [hit]);
      }
      themes.set(theme.id, { wordCount: theme.words.length, levels });
      if (!this.isMediaPack(theme) && theme.kind !== "text") continue;
      const drafts = this.categoryDrafts(theme);
      if (drafts.length === 0) continue;
      const shells: StaticCategory[] = [];
      for (const draft of drafts) {
        const catLevels = emptyLevels();
        for (const word of draft.words) {
          catLevels[word.level] += 1;
          const hit = { themeId: theme.id, categoryId: draft.id, level: word.level };
          const hits = byCategoryWord.get(word.id);
          if (hits) hits.push(hit);
          else byCategoryWord.set(word.id, [hit]);
        }
        shells.push({
          id: draft.id,
          title: draft.title,
          wordCount: draft.words.length,
          levels: catLevels,
        });
      }
      categories.set(theme.id, shells);
    }
    const built: CatalogStats = { themes, categories, byWord, byCategoryWord };
    this.catalogStatsCache = built;
    this.catalogStatsRevision = this.revision;
    return built;
  }
}

function emptyLevels(): LevelCounts {
  return { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
}

const english = new Dictionary("en");
const catalogs = new Map<string, Dictionary>([["en", english]]);

export function getDictionary(language: string): Dictionary {
  const code = language || "en";
  const found = catalogs.get(code);
  if (found) return found;
  if (code === "en") return english;
  const blank = new Dictionary(code);
  catalogs.set(code, blank);
  return blank;
}

function currentDictionary(): Dictionary {
  return getDictionary(activeLanguage());
}

export const dictionary = new Proxy(english, {
  get(_target, prop) {
    const active = currentDictionary();
    const value = (active as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(active) : value;
  },
  set(_target, prop, value) {
    const active = currentDictionary();
    (active as unknown as Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
}) as Dictionary;

export async function loadDictionaries(): Promise<void> {
  await english.load();
  let names: string[] = [];
  try {
    const entries = await readdir(catalogRoot(), { withFileTypes: true });
    names = entries
      .filter((entry) => entry.isDirectory() && /^[a-z]{2}$/.test(entry.name) && entry.name !== "en")
      .map((entry) => entry.name);
  } catch {
    names = [];
  }
  for (const name of names) {
    const paths = languageCatalogPaths(name);
    if (!existsSync(paths.themesDir)) continue;
    const extra = new Dictionary(name);
    await extra.load();
    catalogs.set(name, extra);
  }
}
