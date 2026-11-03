import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { config } from "../packages/api/src/config.js";

const BASE = "https://api.opensubtitles.com/api/v1";

type SubtitleFile = { file_id: number; file_name?: string };
type SubtitleHit = {
  id?: string;
  attributes?: {
    language?: string;
    download_count?: number;
    hearing_impaired?: boolean;
    files?: SubtitleFile[];
    feature_details?: { title?: string; year?: number; season_number?: number; episode_number?: number };
  };
};

export type OpenSubtitlesQuery = {
  query?: string;
  imdbId?: number;
  tmdbId?: number;
  year?: number;
  kind: "movie" | "episode";
  season?: number;
  episode?: number;
  cacheId: string;
};

function headers(token?: string): Headers {
  const out = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "Api-Key": config.opensubtitlesApiKey,
    "User-Agent": config.opensubtitlesUserAgent,
  });
  if (token) out.set("Authorization", `Bearer ${token}`);
  return out;
}

async function osJson<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  if (!config.opensubtitlesApiKey) {
    throw new Error(
      "OPENSUBTITLES_API_KEY is empty — create a consumer at https://www.opensubtitles.com/en/consumers and put the API key in .env",
    );
  }
  const { token, ...rest } = init;
  const response = await fetch(`${BASE}${path}`, { ...rest, headers: headers(token) });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenSubtitles ${init.method ?? "GET"} ${path} HTTP ${response.status}: ${body.slice(0, 400)}`);
  }
  return JSON.parse(body) as T;
}

async function login(): Promise<string | undefined> {
  if (!config.opensubtitlesUsername || !config.opensubtitlesPassword) return undefined;
  const body = await osJson<{ token?: string }>("/login", {
    method: "POST",
    body: JSON.stringify({
      username: config.opensubtitlesUsername,
      password: config.opensubtitlesPassword,
    }),
  });
  if (!body.token) throw new Error("OpenSubtitles login returned no token");
  return body.token;
}

function episodeCodeScore(name: string | undefined, season?: number, episode?: number): number {
  if (!name || !season || !episode) return 0;
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const seasonCode = String(season).padStart(2, "0");
  const episodeCode = String(episode).padStart(2, "0");
  if (compact.includes(`s${seasonCode}e${episodeCode}`) || compact.includes(`${season}x${episodeCode}`)) return 2;
  if (/s\d{2}e\d{2}/.test(compact) || new RegExp(`\\d{1,2}x${episodeCode}|s\\d{2}e\\d{2}`).test(name.toLowerCase())) {
    return -1;
  }
  return 0;
}

function pickFile(hits: SubtitleHit[], season?: number, episode?: number): SubtitleFile {
  const ranked = hits
    .map((hit) => ({
      hit,
      file: hit.attributes?.files?.[0],
      downloads: hit.attributes?.download_count ?? 0,
      hi: Boolean(hit.attributes?.hearing_impaired),
      code: episodeCodeScore(hit.attributes?.files?.[0]?.file_name, season, episode),
    }))
    .filter((row) => row.file?.file_id && row.code >= 0);
  ranked.sort((a, b) => b.code - a.code || Number(a.hi) - Number(b.hi) || b.downloads - a.downloads);
  const file = ranked[0]?.file;
  if (!file) throw new Error("OpenSubtitles returned no English subtitle files");
  return file;
}

function decodeSubtitle(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return gunzipSync(bytes).toString("utf8");
  }
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error("OpenSubtitles sent a zip archive — pick another file_id");
  }
  const text = bytes.toString("utf8");
  if (/^\s*<html/i.test(text)) throw new Error("OpenSubtitles download link returned HTML instead of subtitles");
  return text;
}

export async function fetchOpenSubtitles(input: OpenSubtitlesQuery): Promise<string> {
  const cacheDir = join(config.dictionaryDir, "../source/media");
  const cachePath = join(cacheDir, `${input.cacheId}.en.srt`);
  try {
    const cached = await readFile(cachePath, "utf8");
    if (cached.trim()) {
      console.info(`using cached ${cachePath}`);
      return cachePath;
    }
  } catch {
    // download
  }

  const params = new URLSearchParams({
    languages: "en",
    type: input.kind,
    ai_translated: "exclude",
    machine_translated: "exclude",
    order_by: "download_count",
    order_direction: "desc",
  });
  // IMDb/TMDB already selects the feature. Query and catalog year are AND filters,
  // and OpenSubtitles often stores another year (or 0), which hides the English file.
  const identified = Boolean(input.imdbId || input.tmdbId);
  if (input.query && !identified) params.set("query", input.query);
  if (input.imdbId) params.set("imdb_id", String(input.imdbId));
  if (input.tmdbId) params.set("tmdb_id", String(input.tmdbId));
  if (input.year && !identified) params.set("year", String(input.year));
  if (input.kind === "episode") {
    if (input.season) params.set("season_number", String(input.season));
    if (input.episode) params.set("episode_number", String(input.episode));
  }
  if (!input.query && !input.imdbId && !input.tmdbId) {
    throw new Error("OpenSubtitles needs --query, --imdb or --tmdb");
  }

  const search = await osJson<{ data?: SubtitleHit[] }>(`/subtitles?${params}`);
  const file = pickFile(search.data ?? [], input.season, input.episode);
  const token = await login();
  const download = await osJson<{ link?: string; remaining?: number; reset_time?: string; file_name?: string }>(
    "/download",
    {
      method: "POST",
      token,
      body: JSON.stringify({ file_id: file.file_id, sub_format: "srt" }),
    },
  );
  if (!download.link) throw new Error("OpenSubtitles download returned no link");
  console.info(
    `OpenSubtitles file_id=${file.file_id} remaining=${download.remaining ?? "?"}${
      download.reset_time ? ` reset=${download.reset_time}` : ""
    }`,
  );

  const fileRes = await fetch(download.link);
  if (!fileRes.ok) throw new Error(`OpenSubtitles file HTTP ${fileRes.status}`);
  const text = decodeSubtitle(Buffer.from(await fileRes.arrayBuffer()));
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, text);
  console.info(`wrote ${cachePath} (${download.file_name ?? file.file_name ?? "srt"})`);
  return cachePath;
}
