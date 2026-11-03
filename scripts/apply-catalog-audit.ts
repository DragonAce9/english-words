#!/usr/bin/env npx tsx
/**
 * Apply pedagogical CEFR overrides and theme exclusions to data/themes/*.json.
 * Does NOT re-run frequency tagging (that would undo classroom levels).
 *
 *   npx tsx scripts/apply-catalog-audit.ts
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pedagogicalLevel, type CefrLevel } from "./pedagogical-cefr.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const themesDir = join(root, "data", "en", "themes");
const exclusionsPath = join(root, "data", "theme-exclusions.json");

const CEFR: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

interface ThemeWord {
  id: string;
  en: string;
  ru: string[];
  example?: string;
  level?: string;
}

interface ThemeFile {
  id: string;
  title: string;
  paid: boolean;
  blockId?: string;
  kind?: string;
  words: ThemeWord[];
  [key: string]: unknown;
}

interface Exclusions {
  remove: Record<string, string[]>;
  move: { id: string; from: string; to: string }[];
}

function easier(next: CefrLevel, current: string | undefined): boolean {
  const a = CEFR.indexOf(next);
  const b = CEFR.indexOf((current as CefrLevel) ?? "C2");
  return a !== -1 && (b === -1 || a < b);
}

async function main() {
  const exclusions = JSON.parse(await readFile(exclusionsPath, "utf8")) as Exclusions;
  const files = (await readdir(themesDir)).filter((name) => name.endsWith(".json")).sort();
  const themes = new Map<string, ThemeFile>();
  for (const file of files) {
    const theme = JSON.parse(await readFile(join(themesDir, file), "utf8")) as ThemeFile;
    themes.set(theme.id, theme);
  }

  let scanned = 0;
  let cefrFixes = 0;
  const cefrExamples: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];

  const snapshots = new Map<string, Map<string, ThemeWord>>();
  for (const theme of themes.values()) {
    snapshots.set(theme.id, new Map(theme.words.map((word) => [word.id, word])));
  }

  for (const step of exclusions.move) {
    const from = themes.get(step.from);
    const to = themes.get(step.to);
    const word = from?.words.find((item) => item.id === step.id) ?? snapshots.get(step.from)?.get(step.id);
    if (!from || !to || !word) continue;
    if (!to.words.some((item) => item.id === step.id)) {
      to.words.push({ ...word });
      to.words.sort((a, b) => a.en.localeCompare(b.en));
      moved.push(`${step.id}: ${step.from} → ${step.to}`);
    }
  }

  for (const [themeId, ids] of Object.entries(exclusions.remove)) {
    const theme = themes.get(themeId);
    if (!theme) continue;
    const drop = new Set(ids);
    const before = theme.words.length;
    theme.words = theme.words.filter((word) => {
      if (!drop.has(word.id)) return true;
      removed.push(`${themeId}/${word.en}`);
      return false;
    });
    if (theme.words.length === before) {
      // ids may already have been absent
    }
  }

  for (const theme of themes.values()) {
    for (const word of theme.words) {
      scanned += 1;
      const next = pedagogicalLevel(word.en);
      if (next && easier(next, word.level)) {
        cefrFixes += 1;
        if (cefrExamples.length < 24) {
          cefrExamples.push(`${word.en} ${word.level ?? "?"}→${next} (${theme.id})`);
        }
        word.level = next;
      }
    }
  }

  for (const theme of themes.values()) {
    await writeFile(join(themesDir, `${theme.id}.json`), `${JSON.stringify(theme, null, 2)}\n`, "utf8");
  }

  const uniqueRemoved = [...new Set(removed)];
  console.info(`Scanned ${scanned} catalog listings in ${themes.size} themes`);
  console.info(`CEFR fixes: ${cefrFixes}`);
  for (const example of cefrExamples) console.info(`  ${example}`);
  console.info(`Thematic removals: ${uniqueRemoved.length}`);
  for (const example of uniqueRemoved.slice(0, 40)) console.info(`  - ${example}`);
  if (uniqueRemoved.length > 40) console.info(`  … +${uniqueRemoved.length - 40} more`);
  console.info(`Moves (added if missing): ${moved.length}`);
  for (const example of moved) console.info(`  ${example}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
