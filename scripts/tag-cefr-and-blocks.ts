#!/usr/bin/env npx tsx
/**
 * Tag theme words with CEFR levels (A1–C2) by common-English frequency
 * and attach blockId from data/blocks.json.
 *
 *   npx tsx scripts/tag-cefr-and-blocks.ts
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lemma, pedagogicalLevel, numberLevel, type CefrLevel } from "./pedagogical-cefr.ts";

export { lemma, pedagogicalLevel, numberLevel, type CefrLevel };

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const themesDir = join(root, "data", "en", "themes");
const blocksPath = join(root, "data", "en", "blocks.json");
const sourceDir = join(root, "data", "source");
const COMMON_PATH = join(sourceDir, "google-10000-english-no-swears.txt");
const COMMON_URL =
  "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt";

interface BlockDef {
  id: string;
  title: string;
  order: number;
  themeIds: string[];
}

function levelFromRank(rank: number | undefined): CefrLevel {
  if (rank == null) return "C2";
  if (rank <= 800) return "A1";
  if (rank <= 2000) return "A2";
  if (rank <= 4000) return "B1";
  if (rank <= 7000) return "B2";
  if (rank <= 10000) return "C1";
  return "C2";
}

function levelForWord(_themeId: string, en: string, rank: number | undefined): CefrLevel {
  const pedagogical = pedagogicalLevel(en);
  if (pedagogical) return pedagogical;
  return levelFromRank(rank);
}

async function ensureFrequency(): Promise<Map<string, number>> {
  await mkdir(sourceDir, { recursive: true });
  if (!existsSync(COMMON_PATH)) {
    const res = await fetch(COMMON_URL);
    if (!res.ok) throw new Error(`Failed to download frequency list: ${res.status}`);
    await writeFile(COMMON_PATH, await res.text(), "utf8");
  }
  const text = await readFile(COMMON_PATH, "utf8");
  const ranks = new Map<string, number>();
  let i = 0;
  for (const line of text.split(/\n+/)) {
    const w = line.trim().toLowerCase();
    if (!w) continue;
    i += 1;
    if (!ranks.has(w)) ranks.set(w, i);
  }
  return ranks;
}

async function main() {
  const blocks = JSON.parse(await readFile(blocksPath, "utf8")) as BlockDef[];
  const themeToBlock = new Map<string, string>();
  for (const block of blocks) {
    for (const themeId of block.themeIds) themeToBlock.set(themeId, block.id);
  }

  const ranks = await ensureFrequency();
  const files = (await readdir(themesDir)).filter((f) => f.endsWith(".json"));
  const levelTotals: Record<CefrLevel, number> = {
    A1: 0,
    A2: 0,
    B1: 0,
    B2: 0,
    C1: 0,
    C2: 0,
  };
  let themesTagged = 0;

  for (const file of files) {
    const path = join(themesDir, file);
    const theme = JSON.parse(await readFile(path, "utf8")) as {
      id: string;
      title: string;
      paid: boolean;
      blockId?: string;
      words: { id: string; en: string; ru: string[]; example?: string; level?: string }[];
    };
    const blockId = themeToBlock.get(theme.id) ?? "other";
    theme.blockId = blockId;
    for (const word of theme.words) {
      const level = levelForWord(theme.id, word.en, ranks.get(lemma(word.en)));
      word.level = level;
      levelTotals[level] += 1;
    }
    await writeFile(path, `${JSON.stringify(theme, null, 2)}\n`, "utf8");
    themesTagged += 1;
  }

  console.info(`Tagged ${themesTagged} themes`);
  console.info("Level distribution (listings):", levelTotals);
  const missing = files
    .map((f) => f.replace(/\.json$/, ""))
    .filter((id) => !themeToBlock.has(id));
  if (missing.length) console.warn("Themes not in blocks.json (→ other):", missing);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
