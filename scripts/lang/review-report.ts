import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cachePath, langRoot, readJson, repoRoot, writeJson, type Pair, type Translation } from "./common.js";

interface BuiltCard {
  id: string;
  word?: string;
  en?: string;
  sourceId?: string;
  ru?: string[];
  gender?: string | null;
  example?: string;
  pos?: string;
}

interface ThemeFile {
  id: string;
  title?: string;
  kind?: string;
  words?: BuiltCard[];
}

function line(card: BuiltCard, english: Map<string, Pair>): string {
  const source = english.get(card.sourceId ?? "") ;
  const en = source?.en ?? card.sourceId ?? "";
  const ru = (card.ru ?? source?.ru ?? []).join(", ");
  return `| ${en} | ${ru} | ${card.word ?? card.en ?? ""} | ${card.gender ?? ""} | ${card.pos ?? ""} | ${(card.example ?? "").replace(/\|/g, "/")} |`;
}

function header(): string {
  return "| English | Russian | Target | Gender | POS | Example |\n|---|---|---|---|---|---|";
}

async function main() {
  const target = langRoot();
  const pairs = await readJson<Pair[]>(cachePath("pairs.json"), []);
  const translations = await readJson<Record<string, Translation>>(cachePath("translations.json"), {});
  const english = new Map(pairs.map((pair) => [pair.id, pair]));
  const themeNames = (await readdir(join(target, "themes"))).filter((name) => name.endsWith(".json"));
  const themes: ThemeFile[] = [];
  for (const name of themeNames) {
    themes.push(JSON.parse(await readFile(join(target, "themes", name), "utf8")) as ThemeFile);
  }
  const filled = themes.filter((theme) => (theme.words ?? []).length > 0).sort((a, b) => (a.words?.length ?? 0) - (b.words?.length ?? 0));
  const whole = filled[0];
  const sample: { theme: string; card: BuiltCard }[] = [];
  const seen = new Set<string>();
  for (const theme of themes) {
    for (const card of theme.words ?? []) {
      if (sample.length >= 100) break;
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      sample.push({ theme: theme.id, card });
    }
    if (sample.length >= 100) break;
  }
  let film: ThemeFile | undefined;
  try {
    const mediaNames = (await readdir(join(target, "media"))).filter((name) => name.endsWith(".json"));
    const packs: ThemeFile[] = [];
    for (const name of mediaNames) {
      const pack = JSON.parse(await readFile(join(target, "media", name), "utf8")) as ThemeFile;
      if ((pack.words ?? []).length > 0) packs.push(pack);
    }
    packs.sort((a, b) => (b.words?.length ?? 0) - (a.words?.length ?? 0));
    film = packs[0];
  } catch {
    film = undefined;
  }

  const translated = Object.keys(translations).length;
  const parts = [
    "# French catalog export",
    "",
    "This file is a dump for a person to review. It is not a completed review.",
    `Translations in cache: ${translated}. Built theme files: ${themes.length}. Themes with at least one card: ${filled.length}.`,
    "Cards below are whatever the translator returned. Nobody has checked that the French word, gender, or example is right.",
    "",
  ];
  if (whole) {
    parts.push(`## Whole theme: ${whole.title ?? whole.id} (${whole.words?.length ?? 0} cards)`, "", header());
    for (const card of whole.words ?? []) parts.push(line(card, english));
    parts.push("");
  } else {
    parts.push("## Whole theme", "", "No translated cards yet.", "");
  }
  parts.push(`## Sample across themes (${sample.length} cards, target 100)`, "", header());
  for (const item of sample) parts.push(line(item.card, english));
  parts.push("");
  const filmCards = (film?.words ?? []).slice(0, 30);
  parts.push(`## One film (${film?.title ?? film?.id ?? "none"}, ${filmCards.length} cards, target 30)`, "", header());
  for (const card of filmCards) parts.push(line(card, english));
  parts.push("");

  const body = `${parts.join("\n")}\n`;
  const path = cachePath("review.md");
  await writeJson(path.replace(/review\.md$/, "review-meta.json"), {
    translated,
    themes: themes.length,
    filled: filled.length,
    sample: sample.length,
    film: filmCards.length,
    reviewedByHuman: false,
  });
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  console.info(`wrote ${path}`);
  console.info(`sample ${sample.length}, film ${filmCards.length}, human review: no`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
