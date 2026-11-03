import { catalogGeneration, readThemeCatalog, storeThemeCatalog } from "./catalogCache.js";
import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { categoryTallyKey, dictionary, type CatalogTally } from "./dictionary.js";
import { targetHead } from "./languages.js";
import { HttpError } from "./session.js";
import type {
  AppUser,
  CefrLevel,
  DictTheme,
  DictWord,
  LevelCounts,
  ThemeBlockSummary,
  ThemeBlockWire,
  ThemeCategorySummary,
  ThemeSummary,
  ThemeWordListItem,
  ThemeWordListResponse,
} from "./types.js";
import { CEFR_LEVELS } from "./types.js";
import { themeClaimable, themeFreePick, themeLocked, themeReferralPick } from "./access.js";
import { listStudyingIds } from "./studying.js";
import { MY_WORDS_THEME_ID, myWordsTheme } from "./studyWords.js";
import { loadTextPack, parseTextThemeId } from "./texts.js";
import { extrasByTheme, loadUserWordRows, mergeTheme, themeForUser, uniqueCatalogWordCount } from "./userWords.js";

function emptyLevels(): LevelCounts {
  return { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
}

function summarizeTheme(
  theme: DictTheme,
  known: Set<string>,
  studyingIds: Set<string>,
  user: AppUser,
): ThemeSummary {
  const locked = themeLocked(theme, user);
  const levels = emptyLevels();
  const knownByLevel = emptyLevels();
  for (const word of theme.words) {
    levels[word.level] += 1;
    if (known.has(word.id)) knownByLevel[word.level] += 1;
  }
  const knownCount = theme.words.filter((word) => known.has(word.id)).length;
  const categories =
    dictionary.isMediaPack(theme) || theme.kind === "text" ? dictionary.packCategories(theme, known) : [];
  return {
    id: theme.id,
    title: theme.title,
    blockId: theme.blockId,
    wordCount: theme.words.length,
    knownCount,
    paid: theme.paid,
    locked,
    claimable: themeClaimable(theme, user),
    freePick: themeFreePick(theme, user),
    referralPick: themeReferralPick(theme, user),
    studying: studyingIds.has(theme.id) && knownCount < theme.words.length,
    levels,
    knownByLevel,
    posterUrl: theme.posterUrl ?? null,
    kind: theme.kind,
    year: theme.year ?? null,
    showId: theme.showId ?? null,
    showTitle: theme.showTitle ?? null,
    season: theme.season ?? null,
    episode: theme.episode ?? null,
    episodeTitle: theme.episodeTitle ?? null,
    categories: categories.length > 0 ? categories : undefined,
  };
}

function hasAddedWords(theme: DictTheme, extras: DictWord[] | undefined): boolean {
  if (!extras || extras.length === 0) return false;
  const seen = new Set(theme.words.map((word) => word.id));
  return extras.some((word) => !seen.has(word.id));
}

function summaryFromStats(
  theme: DictTheme,
  known: Set<string>,
  knownByTheme: Map<string, CatalogTally>,
  knownByCategory: Map<string, CatalogTally>,
  studyingIds: Set<string>,
  user: AppUser,
): ThemeSummary {
  const stat = dictionary.themeStat(theme.id);
  if (!stat) return summarizeTheme(theme, known, studyingIds, user);
  const tally = knownByTheme.get(theme.id);
  const knownCount = tally?.count ?? 0;
  const knownByLevel = tally ? { ...tally.levels } : emptyLevels();
  let categories: ThemeCategorySummary[] | undefined;
  if (dictionary.isMediaPack(theme) || theme.kind === "text") {
    const shells = dictionary.themeCategories(theme.id);
    if (shells && shells.length > 0) {
      categories = shells.map((shell) => {
        const knownShell = knownByCategory.get(categoryTallyKey(theme.id, shell.id));
        return {
          id: shell.id,
          title: shell.title,
          wordCount: shell.wordCount,
          knownCount: knownShell?.count ?? 0,
          levels: { ...shell.levels },
          knownByLevel: knownShell ? { ...knownShell.levels } : emptyLevels(),
        };
      });
    }
  }
  const locked = themeLocked(theme, user);
  return {
    id: theme.id,
    title: theme.title,
    blockId: theme.blockId,
    wordCount: stat.wordCount,
    knownCount,
    paid: theme.paid,
    locked,
    claimable: themeClaimable(theme, user),
    freePick: themeFreePick(theme, user),
    referralPick: themeReferralPick(theme, user),
    studying: studyingIds.has(theme.id) && knownCount < stat.wordCount,
    levels: stat.levels,
    knownByLevel,
    posterUrl: theme.posterUrl ?? null,
    kind: theme.kind,
    year: theme.year ?? null,
    showId: theme.showId ?? null,
    showTitle: theme.showTitle ?? null,
    season: theme.season ?? null,
    episode: theme.episode ?? null,
    episodeTitle: theme.episodeTitle ?? null,
    categories,
  };
}

async function loadThemeSummaries(user: AppUser): Promise<{ themes: ThemeSummary[]; catalogWordCount: number }> {
  const [rows, extraRows, studyingIds] = await Promise.all([
    sql<{ word_id: string }[]>`
      SELECT word_id
      FROM word_progress
      WHERE user_id = ${user.id} AND language = ${activeLanguage()} AND status = 'known'
    `,
    loadUserWordRows(user.id),
    listStudyingIds(user.id, user.language),
  ]);
  const known = new Set(rows.map((row) => dictionary.resolveWordId(row.word_id)));
  const extras = extrasByTheme(extraRows);
  const overlay = dictionary.overlayKnown(known);

  const catalog = dictionary.listThemes().map((base) => {
    const extra = extras.get(base.id);
    if (hasAddedWords(base, extra)) {
      return summarizeTheme(mergeTheme(base, extra), known, studyingIds, user);
    }
    return summaryFromStats(base, known, overlay.themes, overlay.categories, studyingIds, user);
  });

  const textPacks: ThemeSummary[] = [];
  for (const id of studyingIds) {
    if (!parseTextThemeId(id)) continue;
    const pack = await loadTextPack(user, id);
    if (pack) textPacks.push(summarizeTheme(pack, known, studyingIds, user));
  }

  const mine = await myWordsTheme(user.id, user.language);
  const personal = mine ? [summarizeTheme(mine, known, studyingIds, user)] : [];

  return {
    themes: [...catalog, ...textPacks, ...personal],
    catalogWordCount: uniqueCatalogWordCount(extraRows),
  };
}

export async function listThemes(user: AppUser): Promise<ThemeSummary[]> {
  return (await loadThemeSummaries(user)).themes;
}

export interface ThemeCatalog {
  themes: ThemeSummary[];
  blocks: ThemeBlockWire[];
  catalogWordCount: number;
}

function themeCacheKey(user: AppUser): string {
  const picks = [...(user.referralUnlocks ?? [])].sort().join(",");
  return `${user.id}:${activeLanguage()}:${dictionary.revision}:${user.subscribed ? 1 : 0}:${user.freeMediaId ?? ""}:${picks}`;
}

export async function listThemeCatalog(user: AppUser): Promise<ThemeCatalog> {
  const key = themeCacheKey(user);
  const cached = readThemeCatalog<ThemeCatalog>(key);
  if (cached) return cached;
  const generation = catalogGeneration(user.id);
  const { themes, catalogWordCount } = await loadThemeSummaries(user);
  const catalog: ThemeCatalog = {
    themes,
    blocks: groupThemeBlocks(themes).map((block) => ({
      id: block.id,
      title: block.title,
      order: block.order,
      themeIds: block.themes.map((theme) => theme.id),
    })),
    catalogWordCount,
  };
  storeThemeCatalog(key, catalog, user.id, generation);
  return catalog;
}

export async function listThemeBlocks(user: AppUser): Promise<ThemeBlockSummary[]> {
  const catalog = await listThemeCatalog(user);
  const byId = new Map(catalog.themes.map((theme) => [theme.id, theme]));
  return catalog.blocks.map((block) => ({
    id: block.id,
    title: block.title,
    order: block.order,
    themes: block.themeIds
      .map((id) => byId.get(id))
      .filter((theme): theme is ThemeSummary => theme != null),
  }));
}

function groupThemeBlocks(themes: ThemeSummary[]): ThemeBlockSummary[] {
  const mediaThemes = themes.filter((theme) => theme.blockId === "media");
  const catalogThemes = themes.filter(
    (theme) => theme.blockId !== "media" && theme.kind !== "text" && theme.id !== MY_WORDS_THEME_ID,
  );
  const byId = new Map(catalogThemes.map((theme) => [theme.id, theme]));
  const blocks = dictionary.listBlocks().map((block) => ({
    id: block.id,
    title: block.title,
    order: block.order,
    themes: block.themeIds
      .map((id) => byId.get(id))
      .filter((theme): theme is ThemeSummary => Boolean(theme)),
  }));

  const placed = new Set(blocks.flatMap((block) => block.themes.map((theme) => theme.id)));
  const blockIds = new Set(blocks.map((block) => block.id));
  // A file that still names a real block, but was left out of blocks.json, stays unlisted.
  // Files with no block, or blockId "other", still surface under Прочее.
  const orphan = catalogThemes.filter((theme) => {
    if (placed.has(theme.id)) return false;
    if (theme.blockId && theme.blockId !== "other" && blockIds.has(theme.blockId)) return false;
    return true;
  });
  if (orphan.length > 0) {
    const other = blocks.find((block) => block.id === "other");
    if (other) other.themes.push(...orphan);
    else {
      blocks.push({
        id: "other",
        title: "Прочее",
        order: 99,
        themes: orphan,
      });
    }
  }

  if (mediaThemes.length > 0) {
    blocks.unshift({
      id: "media",
      title: "Кино и сериалы",
      order: 0,
      themes: mediaThemes,
    });
  }

  return blocks.sort((a, b) => a.order - b.order);
}

export function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === "string" && (CEFR_LEVELS as string[]).includes(value);
}

export async function listThemeWords(
  user: AppUser,
  themeId: string,
  level: CefrLevel | null = null,
  categoryId: string | null = null,
): Promise<ThemeWordListResponse> {
  const theme = await themeForUser(user, themeId);
  if (!theme) throw new HttpError("Theme not found", 404, "not_found");
  if (themeLocked(theme, user)) {
    throw new HttpError("Subscription required", 403, "subscription_required");
  }

  const rows = await sql<{ word_id: string }[]>`
    SELECT word_id
    FROM word_progress
    WHERE user_id = ${user.id} AND language = ${activeLanguage()} AND status = 'known'
  `;
  const known = new Set(rows.map((row) => dictionary.resolveWordId(row.word_id)));

  const scoped = dictionary.wordsForCategory(theme, categoryId);
  const pool = level ? scoped.filter((word) => word.level === level) : scoped;
  const words: ThemeWordListItem[] = pool.map((word) => {
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
      known: known.has(word.id),
    };
  });
  const language = activeLanguage();
  words.sort((a, b) => {
    if (theme.id === "numbers") return 0;
    const head = (a.word || a.en).localeCompare(b.word || b.en, language, { sensitivity: "base" });
    return head || a.id.localeCompare(b.id);
  });

  const categoryTitle =
    categoryId === "uncategorized"
      ? "Прочее"
      : categoryId
        ? (dictionary.getTheme(categoryId)?.title ?? "Прочее")
        : null;

  return {
    themeId: theme.id,
    title: categoryTitle ? `${theme.title} · ${categoryTitle}` : theme.title,
    level,
    categoryId,
    knownCount: words.filter((word) => word.known).length,
    words,
  };
}
