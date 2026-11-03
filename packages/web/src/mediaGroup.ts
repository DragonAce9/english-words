import { CEFR_LEVELS, type LevelCounts, type ThemeSummary } from "./types";

const EPISODE_ID = /^(.*)-s(\d+)e(\d+)$/i;
const EPISODE_TITLE = /^(.*?)\s*·\s*S(\d+)E(\d+)\s*(.*)$/i;

function emptyLevels(): LevelCounts {
  return { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
}

function addLevels(left: LevelCounts, right: LevelCounts): LevelCounts {
  const out = emptyLevels();
  for (const level of CEFR_LEVELS) out[level] = left[level] + right[level];
  return out;
}

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function episodeMeta(theme: ThemeSummary): {
  showId: string | null;
  showTitle: string;
  season: number | null;
  episode: number | null;
  episodeTitle: string;
} {
  const idMatch = theme.id.match(EPISODE_ID);
  const titleMatch = theme.title.match(EPISODE_TITLE);
  return {
    showId: theme.showId ?? idMatch?.[1] ?? null,
    showTitle: theme.showTitle ?? titleMatch?.[1]?.trim() ?? theme.title,
    season: theme.season ?? (idMatch ? Number(idMatch[2]) : titleMatch ? Number(titleMatch[2]) : null),
    episode: theme.episode ?? (idMatch ? Number(idMatch[3]) : titleMatch ? Number(titleMatch[3]) : null),
    episodeTitle: theme.episodeTitle ?? titleMatch?.[4]?.trim() ?? "",
  };
}

export function episodeListTitle(theme: ThemeSummary): string {
  const meta = episodeMeta(theme);
  if (meta.season == null || meta.episode == null) return theme.title;
  const code = episodeCode(meta.season, meta.episode);
  return meta.episodeTitle ? `${code} · ${meta.episodeTitle}` : code;
}

export function seriesId(showId: string): string {
  return `show:${showId}`;
}

export function ruEpisodes(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return `${count} серия`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${count} серии`;
  return `${count} серий`;
}

export function studyingPackIds(theme: ThemeSummary): string[] {
  if (theme.kind === "series") return (theme.episodes ?? []).map((item) => item.id);
  return [theme.id];
}

export function findSeries(themes: ThemeSummary[], showId: string): ThemeSummary | undefined {
  return groupMediaThemes(themes).find(
    (theme) => theme.kind === "series" && (theme.showId === showId || theme.id === seriesId(showId)),
  );
}

function buildSeries(showId: string, episodes: ThemeSummary[]): ThemeSummary {
  const sorted = [...episodes].sort((a, b) => {
    const season = (a.season ?? 0) - (b.season ?? 0);
    if (season !== 0) return season;
    return (a.episode ?? 0) - (b.episode ?? 0);
  });
  const first = sorted[0]!;
  const meta = episodeMeta(first);
  return {
    id: seriesId(showId),
    title: meta.showTitle,
    blockId: first.blockId,
    wordCount: sorted.reduce((sum, item) => sum + item.wordCount, 0),
    knownCount: sorted.reduce((sum, item) => sum + item.knownCount, 0),
    paid: sorted.every((item) => item.paid),
    locked: sorted.some((item) => item.locked),
    claimable: sorted.every((item) => item.claimable),
    freePick: sorted.some((item) => item.freePick),
    referralPick: sorted.some((item) => item.referralPick),
    studying: sorted.some((item) => item.studying),
    levels: sorted.reduce((acc, item) => addLevels(acc, item.levels), emptyLevels()),
    knownByLevel: sorted.reduce((acc, item) => addLevels(acc, item.knownByLevel), emptyLevels()),
    posterUrl: first.posterUrl,
    kind: "series",
    year: first.year,
    showId,
    showTitle: meta.showTitle,
    episodes: sorted,
  };
}

export function groupMediaThemes(themes: ThemeSummary[]): ThemeSummary[] {
  const buckets = new Map<string, ThemeSummary[]>();
  for (const theme of themes) {
    if (theme.kind !== "episode") continue;
    const meta = episodeMeta(theme);
    if (!meta.showId) continue;
    const episode: ThemeSummary = {
      ...theme,
      title: episodeListTitle(theme),
      showId: meta.showId,
      showTitle: meta.showTitle,
      season: meta.season ?? undefined,
      episode: meta.episode ?? undefined,
      episodeTitle: meta.episodeTitle || undefined,
    };
    const list = buckets.get(meta.showId) ?? [];
    list.push(episode);
    buckets.set(meta.showId, list);
  }

  const grouped: ThemeSummary[] = [];
  const used = new Set<string>();
  for (const theme of themes) {
    if (theme.kind === "series") {
      grouped.push(theme);
      continue;
    }
    if (theme.kind !== "episode") {
      grouped.push(theme);
      continue;
    }
    const meta = episodeMeta(theme);
    if (!meta.showId || !buckets.has(meta.showId)) {
      grouped.push(theme);
      continue;
    }
    if (used.has(meta.showId)) continue;
    used.add(meta.showId);
    grouped.push(buildSeries(meta.showId, buckets.get(meta.showId)!));
  }
  return grouped;
}
