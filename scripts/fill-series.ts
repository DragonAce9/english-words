import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../packages/api/src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const mediaDir = resolve(root, "data/en/media");
const sourceDir = resolve(root, "data/source/media");
const dictionaryDir = resolve(root, "data/en/themes");

/** Leave a few downloads for a failed retry. OpenSubtitles resets this quota daily. */
const DOWNLOAD_BUDGET = 90;
const SEASON_ONE_EPISODES = 3;

type NamedShow = { tvmaze: number; showId: string; title: string };

const NAMED: NamedShow[] = [
  { tvmaze: 184, showId: "bojack-horseman", title: "BoJack Horseman" },
  { tvmaze: 82, showId: "game-of-thrones", title: "Game of Thrones" },
  { tvmaze: 44778, showId: "house-of-the-dragon", title: "House of the Dragon" },
  { tvmaze: 45039, showId: "slow-horses", title: "Slow Horses" },
  { tvmaze: 44458, showId: "ted-lasso", title: "Ted Lasso" },
  { tvmaze: 55352, showId: "clarksons-farm", title: "Clarkson's Farm" },
  { tvmaze: 38052, showId: "silo", title: "Silo" },
  { tvmaze: 83360, showId: "stuart-fails-to-save-the-universe", title: "Stuart Fails to Save the Universe" },
  { tvmaze: 69327, showId: "common-side-effects", title: "Common Side Effects" },
  { tvmaze: 522, showId: "top-gear", title: "Top Gear" },
  { tvmaze: 19, showId: "supernatural", title: "Supernatural" },
  { tvmaze: 676, showId: "sex-and-the-city", title: "Sex and the City" },
  { tvmaze: 5, showId: "true-detective", title: "True Detective" },
  { tvmaze: 67, showId: "greys-anatomy", title: "Grey's Anatomy" },
  { tvmaze: 1859, showId: "lucifer", title: "Lucifer" },
  { tvmaze: 169, showId: "breaking-bad", title: "Breaking Bad" },
  { tvmaze: 527, showId: "the-sopranos", title: "The Sopranos" },
  { tvmaze: 17078, showId: "the-grand-tour", title: "The Grand Tour" },
  { tvmaze: 55138, showId: "arcane", title: "Arcane" },
  { tvmaze: 335, showId: "sherlock", title: "Sherlock" },
  { tvmaze: 26020, showId: "young-sheldon", title: "Young Sheldon" },
  { tvmaze: 66, showId: "the-big-bang-theory", title: "The Big Bang Theory" },
  { tvmaze: 532, showId: "scrubs", title: "Scrubs" },
  { tvmaze: 526, showId: "the-office", title: "The Office" },
  { tvmaze: 13417, showId: "ozark", title: "Ozark" },
  { tvmaze: 171, showId: "how-i-met-your-mother", title: "How I Met Your Mother" },
];

const EXISTING_FIRST = [
  "friends",
  "lost",
  "the-simpsons",
  "south-park",
  "it-s-always-sunny-in-philadelphia",
  "adventure-time",
  "chicago-fire",
  "fbi",
  "law-and-order-special-victims-unit",
];

type Job = {
  id: string;
  title: string;
  showId: string;
  showTitle: string;
  year: number;
  season: number;
  episode: number;
  episodeTitle: string;
  imdb?: string;
  query: string;
  poster?: string;
  wave: "named" | "existing";
};

type MazeEpisode = { season: number; number: number; name?: string };
type MazeShow = {
  name?: string;
  premiered?: string | null;
  image?: { original?: string | null };
  externals?: { imdb?: string | null };
};

const agent = { "User-Agent": "EnglishWords/1.0 (local catalog)" };

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameShow(parent: string, title: string): boolean {
  const left = norm(parent);
  const right = norm(title);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

async function mazeJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.tvmaze.com${path}`, { headers: agent });
  if (!response.ok) throw new Error(`TVMaze ${path} HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function wikiPoster(title: string): Promise<string | undefined> {
  const names = [title, `${title} (TV series)`, `${title} (television series)`];
  for (const name of names) {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, {
      headers: agent,
    });
    if (!response.ok) continue;
    const body = (await response.json()) as { thumbnail?: { source?: string } };
    const source = body.thumbnail?.source?.split("?")[0];
    if (source) return source;
  }
  return undefined;
}

async function namedJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const show of NAMED) {
    const details = await mazeJson<MazeShow>(`/shows/${show.tvmaze}`);
    const episodes = await mazeJson<MazeEpisode[]>(`/shows/${show.tvmaze}/episodes`);
    const seasonOne = episodes
      .filter((episode) => episode.season === 1 && episode.number > 0)
      .sort((a, b) => a.number - b.number)
      .slice(0, SEASON_ONE_EPISODES);
    const year = Number(String(details.premiered ?? "").slice(0, 4)) || null;
    const poster = details.image?.original ?? (await wikiPoster(show.title));
    const imdb = details.externals?.imdb?.replace(/^tt/i, "");
    for (const episode of seasonOne) {
      const code = `S${pad(episode.season)}E${pad(episode.number)}`;
      const episodeTitle = (episode.name || `Episode ${episode.number}`).replace(/\s+/g, " ").trim();
      jobs.push({
        id: `${show.showId}-s${pad(episode.season)}e${pad(episode.number)}`,
        title: `${show.title} · ${code} ${episodeTitle}`,
        showId: show.showId,
        showTitle: show.title,
        year: year ?? 0,
        season: episode.season,
        episode: episode.number,
        episodeTitle,
        imdb: imdb || undefined,
        query: show.title,
        poster,
        wave: "named",
      });
    }
    await sleep(200);
  }
  return jobs;
}

function nextMissing(episodes: { season: number; episode: number }[]): { season: number; episode: number } | null {
  const has = new Set(episodes.map((episode) => `${episode.season}:${episode.episode}`));
  if (!has.has("1:1")) return { season: 1, episode: 1 };
  for (let episode = 2; episode <= 4; episode += 1) {
    if (!has.has(`1:${episode}`)) return { season: 1, episode };
  }
  return null;
}

async function existingJobs(namedIds: Set<string>): Promise<Job[]> {
  const files = (await readdir(mediaDir)).filter((file) => file.endsWith(".json"));
  const groups = new Map<
    string,
    { title: string; year: number; poster?: string; episodes: { season: number; episode: number }[] }
  >();
  for (const file of files) {
    const pack = JSON.parse(await readFile(resolve(mediaDir, file), "utf8")) as {
      kind?: string;
      showId?: string;
      showTitle?: string;
      season?: number;
      episode?: number;
      year?: number;
      posterUrl?: string | null;
    };
    if (pack.kind !== "episode" || !pack.showId || namedIds.has(pack.showId)) continue;
    const group = groups.get(pack.showId) ?? {
      title: pack.showTitle || pack.showId,
      year: pack.year ?? 0,
      poster: pack.posterUrl || undefined,
      episodes: [],
    };
    if (pack.posterUrl) group.poster = pack.posterUrl;
    if (pack.season && pack.episode) group.episodes.push({ season: pack.season, episode: pack.episode });
    groups.set(pack.showId, group);
  }

  const ranked = [...groups.entries()].sort((left, right) => {
    const ai = EXISTING_FIRST.indexOf(left[0]);
    const bi = EXISTING_FIRST.indexOf(right[0]);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    const late = (episodes: { season: number }[]) => (episodes.some((episode) => episode.season >= 2) ? 0 : 1);
    return late(left[1].episodes) - late(right[1].episodes) || left[0].localeCompare(right[0]);
  });

  const jobs: Job[] = [];
  for (const [showId, group] of ranked) {
    if (group.episodes.length >= 3) continue;
    const missing = nextMissing(group.episodes);
    if (!missing) continue;
    const code = `S${pad(missing.season)}E${pad(missing.episode)}`;
    const poster = group.poster || (await wikiPoster(group.title));
    jobs.push({
      id: `${showId}-s${pad(missing.season)}e${pad(missing.episode)}`,
      title: `${group.title} · ${code}`,
      showId,
      showTitle: group.title,
      year: group.year,
      season: missing.season,
      episode: missing.episode,
      episodeTitle: "",
      query: group.title,
      poster,
      wave: "existing",
    });
  }
  return jobs;
}

async function englishHit(job: Job): Promise<boolean> {
  const params = new URLSearchParams({
    languages: "en",
    type: "episode",
    ai_translated: "exclude",
    machine_translated: "exclude",
    season_number: String(job.season),
    episode_number: String(job.episode),
  });
  if (job.imdb) params.set("imdb_id", String(Number(job.imdb)));
  else params.set("query", job.query);
  const response = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params}`, {
    headers: {
      Accept: "application/json",
      "Api-Key": config.opensubtitlesApiKey,
      "User-Agent": config.opensubtitlesUserAgent,
    },
  });
  if (!response.ok) return false;
  const body = (await response.json()) as {
    data?: { attributes?: { feature_details?: { parent_title?: string; movie_name?: string; title?: string } } }[];
  };
  const feature = body.data?.[0]?.attributes?.feature_details;
  if (!feature) return false;
  const parent = feature.parent_title || feature.movie_name || feature.title || "";
  return sameShow(parent, job.showTitle);
}

function runImport(job: Job): Promise<{ code: number; output: string }> {
  const args = [
    "run",
    "import:media",
    "--",
    "--id",
    job.id,
    "--title",
    job.title,
    "--kind",
    "episode",
    "--year",
    String(job.year),
    "--season",
    String(job.season),
    "--episode",
    String(job.episode),
    "--show-id",
    job.showId,
    "--show-title",
    job.showTitle,
    "--ai",
  ];
  if (job.episodeTitle) args.push("--episode-title", job.episodeTitle);
  if (job.imdb) args.push("--imdb", String(Number(job.imdb)));
  else args.push("--query", job.query);
  if (job.poster) args.push("--poster", job.poster);
  return new Promise((resolvePromise) => {
    const child = spawn("npm", args, {
      cwd: root,
      env: { ...process.env, DICTIONARY_DIR: dictionaryDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const take = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

function quotaClosed(output: string): boolean {
  return /HTTP 406|download limit|remaining downloads/i.test(output);
}

async function main() {
  const named = await namedJobs();
  const existing = await existingJobs(new Set(NAMED.map((show) => show.showId)));
  const queue = [...named, ...existing];
  const imported: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const deferred: string[] = [];
  let downloads = 0;
  let closed = false;

  for (const job of queue) {
    const packPath = resolve(mediaDir, `${job.id}.json`);
    if (existsSync(packPath)) {
      skipped.push(job.id);
      continue;
    }
    const cachePath = resolve(sourceDir, `${job.id}.en.srt`);
    const cached = existsSync(cachePath);
    if (!cached && (closed || downloads >= DOWNLOAD_BUDGET)) {
      deferred.push(job.id);
      continue;
    }
    const hit = await englishHit(job);
    if (!hit) {
      failed.push(`${job.id}:no-subtitle`);
      console.error(`no english subtitle for ${job.id}`);
      continue;
    }
    console.info(`\n=== ${job.wave} ${job.id} downloads ${downloads}/${DOWNLOAD_BUDGET} ===`);
    let result = await runImport(job);
    if (result.code !== 0 && /HTTP 429|HTTP 503/.test(result.output)) {
      await sleep(20000);
      result = await runImport(job);
    }
    if (!cached && existsSync(cachePath)) downloads += 1;
    if (quotaClosed(result.output)) closed = true;
    if (result.code === 0 && existsSync(packPath)) imported.push(job.id);
    else failed.push(job.id);
    await sleep(400);
  }

  console.info(
    `\nfill-series done imported=${imported.length} failed=${failed.length} skipped=${skipped.length} deferred=${deferred.length} downloads=${downloads}`,
  );
  console.info(`imported ${imported.join(" ")}`);
  if (failed.length) console.info(`failed ${failed.join(" ")}`);
  if (deferred.length) console.info(`deferred ${deferred.join(" ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
