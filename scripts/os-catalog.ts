import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultIndex = resolve(here, "../data/source/media/os-en-catalog.tsv");

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
  npm run os:catalog -- --index ~/Downloads/subtitles_all.txt
  npm run os:catalog -- [--kind movie|episode] [--limit 20] matrix

The dump is metadata only. Search the local English index, then:
  npm run import:media -- --id the-matrix --title "The Matrix" --kind movie --imdb 0133093 --year 1999 --paid`);
  process.exit(1);
}

function buildIndex(dumpPath: string, outPath: string): Promise<void> {
  const py = resolve(here, "os-catalog-index.py");
  return new Promise((resolvePromise, reject) => {
    const child = spawn("python3", [py, dumpPath, outPath], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`indexer exited ${code}`));
    });
  });
}

function showName(title: string): string {
  const quoted = title.match(/^"([^"]+)"/);
  return (quoted?.[1] ?? title).toLowerCase();
}

function rankTitle(title: string, needle: string): number {
  const show = showName(title);
  const normalized = title.toLowerCase();
  if (show === needle) return 0;
  if (normalized === needle) return 1;
  if (show.startsWith(`${needle} `) || show.startsWith(needle)) return 2;
  if (normalized.includes(` ${needle}`)) return 3;
  if (normalized.includes(needle)) return 4;
  return 9;
}

async function search(indexPath: string, query: string, kind?: string, limit = 20) {
  const text = await readFile(indexPath, "utf8");
  const needle = query.toLowerCase().replace(/^"+|"+$/g, "");
  const hits: { line: string; rank: number }[] = [];
  for (const line of text.split("\n").slice(1)) {
    if (!line) continue;
    const [title, , rowKind] = line.split("\t");
    if (kind && rowKind !== kind) continue;
    const rank = rankTitle(title ?? "", needle);
    if (rank === 9) continue;
    hits.push({ line, rank });
  }
  hits.sort((a, b) => a.rank - b.rank);
  const shown = hits.slice(0, limit);
  if (shown.length === 0) {
    console.info("no matches — build the index first: npm run os:catalog -- --index ~/Downloads/subtitles_all.txt");
    return;
  }
  console.info("title\tyear\tkind\timdb\tseason\tepisode\tparent\tsrt_count");
  for (const hit of shown) console.info(hit.line);
}

async function main() {
  const indexPath = arg("out") ?? process.env.OS_CATALOG ?? defaultIndex;
  const dump = arg("index");
  if (dump) {
    await buildIndex(resolve(dump), indexPath);
    return;
  }
  const skipValue = new Set(["index", "out", "kind", "limit"]);
  const words: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      words.push(item);
      continue;
    }
    const name = item.slice(2);
    if (skipValue.has(name) && argv[i + 1] && !argv[i + 1].startsWith("--")) i += 1;
  }
  const query = words.join(" ").trim();
  if (!query) usage();
  const kind = arg("kind");
  if (kind && kind !== "movie" && kind !== "episode") usage();
  const limit = arg("limit") ? Number(arg("limit")) : 20;
  await search(indexPath, query, kind, Number.isFinite(limit) ? limit : 20);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
