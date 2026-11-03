import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { languageCatalogPaths } from "../packages/api/src/catalogPaths.js";
import { config } from "../packages/api/src/config.js";
import { dictionary } from "../packages/api/src/dictionary.js";
import { fileMediaLemma } from "../packages/api/src/mediaCategory.js";
import { catalogSenses, pickClassifiedSense, resolveSenses, senseOccurrences } from "../packages/api/src/senses.js";
import { parseSubtitle } from "../packages/api/src/subtitles.js";
import type { CefrLevel, DictWord } from "../packages/api/src/types.js";

const MAX_WORDS = 2500;
const POSTER = "https://image.tmdb.org/t/p/w342";

const STOPWORDS = new Set(
  `a an the and or but if then than as at by for from in into of on to with without about above after again all also am is are was were be been being can could would should will just not no nor so such too very more most other some any every each few many much own same both once only over under further here there when where why how what which who whom this that these those i me my we our you your he she it they them his her its their do does did done have has had having get got go going went gone make made take took come came see saw know knew think thought want need like look use used using say said tell told`.split(
    /\s+/,
  ),
);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.error(`Usage:
  npm run import:media -- \\
    --id lost-s01e01 \\
    --title "Lost · S01E01 Pilot" \\
    --kind episode \\
    --srt ./pilot.srt \\
    [--query "Lost"] [--imdb 0411008] [--tmdb 4607] [--season 1] [--episode 1] \\
    [--poster URL] [--year 2004] \\
    [--ai] [--lemmas ./lemmas.json] [--unknown-out ./unknown.json]

Pass --srt, or fetch English subtitles from OpenSubtitles.com (--query / --imdb / --tmdb).
    [--lang en]
Users never upload films. This writes data/<lang>/media/<id>.json, then restart the API.`);
  process.exit(1);
}

function slugWord(en: string): string {
  return en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "word";
}

function extractTokens(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.match(/[A-Za-z][A-Za-z'-]{1,}/g) ?? []) {
    const token = raw.toLowerCase().replace(/^'+|'+$/g, "");
    if (token.length < 2 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    found.push(token);
  }
  return found;
}

function exampleFromSource(source: string, token: string): string {
  if (!token) return "";
  const needle = token.toLowerCase();
  for (const part of source.split(/(?<=[.!?])\s+|\n+/)) {
    if (!part.toLowerCase().includes(needle)) continue;
    const trimmed = part.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    return trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
  }
  return "";
}

function posterUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${POSTER}${path}`;
}

async function tmdb(path: string, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
  if (!config.tmdbApiKey) {
    throw new Error("TMDB_API_KEY is empty — pass --poster or set the key");
  }
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", config.tmdbApiKey);
  url.searchParams.set("language", "en-US");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function resolvePoster(input: {
  kind: "movie" | "episode";
  poster?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
}): Promise<string | null> {
  if (input.poster) return posterUrl(input.poster);
  if (!input.tmdbId) return null;
  if (input.kind === "movie") {
    const body = await tmdb(`/movie/${input.tmdbId}`);
    return posterUrl(typeof body.poster_path === "string" ? body.poster_path : null);
  }
  const show = await tmdb(`/tv/${input.tmdbId}`);
  let still: string | null = null;
  if (input.season && input.episode) {
    const ep = await tmdb(`/tv/${input.tmdbId}/season/${input.season}/episode/${input.episode}`).catch(
      () => null,
    );
    still = posterUrl(typeof ep?.still_path === "string" ? ep.still_path : null);
  }
  return still ?? posterUrl(typeof show.poster_path === "string" ? show.poster_path : null);
}

async function main() {
  const id = arg("id");
  const title = arg("title");
  const kindRaw = arg("kind") ?? "movie";
  const srtArg = arg("srt");
  const query = arg("query");
  const imdbRaw = arg("imdb");
  const tmdbRaw = arg("tmdb");
  if (!id || !title || (kindRaw !== "movie" && kindRaw !== "episode")) usage();
  if (!srtArg && !query && !imdbRaw && !tmdbRaw) usage();
  const kind = kindRaw as "movie" | "episode";

  const srtPath =
    srtArg ??
    (await (
      await import("./opensubtitles.js")
    ).fetchOpenSubtitles({
      cacheId: id,
      kind,
      query,
      imdbId: imdbRaw ? Number(imdbRaw.replace(/^tt/i, "")) : undefined,
      tmdbId: tmdbRaw ? Number(tmdbRaw) : undefined,
      year: arg("year") ? Number(arg("year")) : undefined,
      season: arg("season") ? Number(arg("season")) : undefined,
      episode: arg("episode") ? Number(arg("episode")) : undefined,
    }));

  await dictionary.load();
  const script = parseSubtitle(await readFile(srtPath, "utf8"));
  if (!script) throw new Error("Empty subtitles after parse");

  const words: DictWord[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  const ambiguous: string[] = [];
  const addWord = (word: DictWord, example = "") => {
    if (seen.has(word.id)) return;
    seen.add(word.id);
    words.push(example ? { ...word, example } : word);
  };
  for (const token of extractTokens(script)) {
    const senses = catalogSenses(token);
    if (senses.length > 1) {
      ambiguous.push(token);
      continue;
    }
    if (senses.length === 1) {
      addWord(senses[0]!);
      continue;
    }
    unknown.push(token);
  }
  const hits = ambiguous.flatMap((token) => senseOccurrences(script, token, catalogSenses(token)));
  const picked = await resolveSenses(hits);
  hits.forEach((hit, index) => {
    const word = picked[index];
    if (word) addWord(word, hit.sentence);
  });

  const extra: DictWord[] = [];
  const lemmasPath = arg("lemmas");
  if (flag("ai") || lemmasPath) {
    const classified = lemmasPath
      ? (JSON.parse(await readFile(lemmasPath, "utf8")) as {
          token?: string;
          en: string;
          ru: string[];
          themeId?: string;
          pos?: string;
        }[])
      : await (await import("../packages/api/src/ai.js")).classifyUnknown(unknown);
    for (const word of classified) {
      const senses = catalogSenses(word.en);
      if (senses.length > 0) {
        const sentence = exampleFromSource(script, word.token || word.en);
        addWord(senses.length === 1 ? senses[0]! : pickClassifiedSense(word, sentence, senses), sentence);
        continue;
      }
      const id = slugWord(word.en);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      extra.push({
        id,
        en: word.en,
        ru: (word.ru ?? []).slice(0, 3),
        example: exampleFromSource(script, word.token || word.en),
        level: "B1",
      });
    }
  } else if (unknown.length > 0) {
    console.info(`skipped ${unknown.length} unknown tokens (pass --lemmas or --ai)`);
  }

  const unknownOut = arg("unknown-out");
  if (unknownOut) {
    await writeFile(`${unknownOut}`, `${JSON.stringify(unknown, null, 2)}\n`);
    console.info(`wrote ${unknownOut} (${unknown.length} unknown tokens)`);
  }

  const catalogRoom = Math.max(0, MAX_WORDS - extra.length);
  const sliced = [...words.slice(0, catalogRoom), ...extra];
  if (sliced.length === 0) throw new Error("No catalog words found in subtitles");

  const language = (arg("lang") ?? "en").toLowerCase();
  for (const word of sliced) {
    await fileMediaLemma(word, language);
    if (!dictionary.catalogThemeIdFor(word.id)) {
      throw new Error(`film word ${word.id} was not placed in a category`);
    }
  }

  const yearRaw = arg("year");
  const year = yearRaw ? Number(yearRaw) : null;
  const poster = await resolvePoster({
    kind,
    poster: arg("poster"),
    tmdbId: arg("tmdb") ? Number(arg("tmdb")) : undefined,
    season: arg("season") ? Number(arg("season")) : undefined,
    episode: arg("episode") ? Number(arg("episode")) : undefined,
  });

  const idMatch = id.match(/^(.*)-s(\d+)e(\d+)$/i);
  const titleMatch = title.match(/^(.*?)\s*·\s*S\d+E\d+\s*(.*)$/i);
  const season = arg("season") ? Number(arg("season")) : idMatch ? Number(idMatch[2]) : undefined;
  const episode = arg("episode") ? Number(arg("episode")) : idMatch ? Number(idMatch[3]) : undefined;
  const showId = arg("show-id") ?? (kind === "episode" ? idMatch?.[1] : undefined);
  const showTitle =
    arg("show-title") ?? (kind === "episode" ? titleMatch?.[1]?.trim() || title.split(" · ")[0] : undefined);
  const episodeTitle = arg("episode-title") ?? (kind === "episode" ? titleMatch?.[2]?.trim() || undefined : undefined);

  const pack = {
    id,
    title,
    paid: true,
    blockId: "media",
    kind,
    year: Number.isFinite(year) ? year : null,
    posterUrl: poster,
    ...(kind === "episode"
      ? {
          showId: showId ?? null,
          showTitle: showTitle ?? null,
          season: typeof season === "number" && Number.isFinite(season) ? season : null,
          episode: typeof episode === "number" && Number.isFinite(episode) ? episode : null,
          episodeTitle: episodeTitle ?? null,
        }
      : {}),
    words: sliced.map((word) => ({
      id: word.id,
      en: word.en,
      ru: word.ru,
      example: word.example,
      level: word.level as CefrLevel,
    })),
  };

  const mediaDir = languageCatalogPaths(language).mediaDir;
  await mkdir(mediaDir, { recursive: true });
  const out = join(mediaDir, `${id}.json`);
  await writeFile(out, `${JSON.stringify(pack, null, 2)}\n`);
  console.info(`wrote ${out} (${pack.words.length} words)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
