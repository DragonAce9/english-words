import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dict = resolve(root, "data/en/themes");
const mediaDir = resolve(root, "data/en/media");
const sourceDir = resolve(root, "data/source/media");

const LEMMAS: Record<string, string> = {
  shrek: "shrek-lemmas.json",
  "friends-s01e01": "friends-s01e01-lemmas.json",
  sintel: "sintel-lemmas.json",
  "tears-of-steel": "tos-lemmas.json",
};

function srtPath(id: string): string | null {
  const candidates = [`${id}.en.srt`, `${id}-en.srt`];
  for (const name of candidates) {
    const path = join(sourceDir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function runImport(args: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", "import:media", "--", ...args], {
      cwd: root,
      env: { ...process.env, DICTIONARY_DIR: dict },
      stdio: "inherit",
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  const files = (await readdir(mediaDir)).filter((name) => name.endsWith(".json")).sort();
  let ok = 0;
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const file of files) {
    const pack = JSON.parse(await readFile(join(mediaDir, file), "utf8")) as {
      id: string;
      title: string;
      kind?: "movie" | "episode";
      year?: number | null;
      paid?: boolean;
      posterUrl?: string | null;
    };
    const srt = srtPath(pack.id);
    if (!srt) {
      skipped.push(pack.id);
      console.info(`skip ${pack.id}: no cached srt`);
      continue;
    }
    const args = [
      "--id",
      pack.id,
      "--title",
      pack.title,
      "--kind",
      pack.kind === "episode" ? "episode" : "movie",
      "--srt",
      srt,
    ];
    if (pack.paid) args.push("--paid");
    if (pack.year) args.push("--year", String(pack.year));
    if (pack.posterUrl) args.push("--poster", pack.posterUrl);
    const lemmas = LEMMAS[pack.id];
    if (lemmas) args.push("--lemmas", join(sourceDir, lemmas));
    console.info(`\n=== ${pack.title} ===`);
    const code = await runImport(args);
    if (code === 0) ok += 1;
    else failed.push(pack.id);
  }
  console.info(`\nreimport done: ${ok} ok, ${skipped.length} skipped, ${failed.length} failed`);
  if (skipped.length) console.info(`skipped: ${skipped.join(", ")}`);
  if (failed.length) {
    console.info(`failed: ${failed.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
