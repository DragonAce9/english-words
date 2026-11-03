import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cachePath,
  langRoot,
  normalizeRu,
  pairKey,
  readJson,
  repoRoot,
  slugHead,
  validPos,
  writeJson,
  type Pair,
  type Translation,
} from "./common.js";

interface Card {
  id: string;
  en: string;
  ru: string[];
  example?: string;
  level?: string;
  pos?: string;
}

interface ThemeFile {
  id: string;
  title: string;
  paid?: boolean;
  blockId?: string;
  words: Card[];
}

interface BuiltCard {
  id: string;
  word: string;
  en: string;
  sourceId: string;
  sourceIds: string[];
  ru: string[];
  gender: "m" | "f" | "n" | null;
  example: string;
  level: string;
  pos: string;
}

const POS = new Set(["n", "v", "adj", "adv", "numeral", "pronoun", "determiner", "preposition", "conjunction", "interjection"]);

function posOf(card: Card, themeId: string, pos: Record<string, string>): string {
  if (card.pos && POS.has(card.pos)) return card.pos;
  const tagged = pos[`${themeId}\t${card.id}`];
  return tagged && POS.has(tagged) ? tagged : "";
}

async function main() {
  const source = join(repoRoot, "data", "en");
  const target = langRoot();
  const pairs = await readJson<Pair[]>(cachePath("pairs.json"), []);
  const translations = await readJson<Record<string, Translation>>(cachePath("translations.json"), {});
  const byKey = new Map(pairs.map((pair) => [pair.key, pair]));
  const pos = await readJson<Record<string, string>>(join(source, "word-pos.json"), {});
  const themeNames = (await readdir(join(source, "themes"))).filter((name) => name.endsWith(".json"));
  await mkdir(join(target, "themes"), { recursive: true });

  const mergeNotes: string[] = [];
  let builtCards = 0;
  let missing = 0;

  for (const name of themeNames) {
    const theme = JSON.parse(await readFile(join(source, "themes", name), "utf8")) as ThemeFile;
    const words: BuiltCard[] = [];
    const index = new Map<string, BuiltCard>();
    for (const card of theme.words ?? []) {
      const listed = posOf(card, theme.id, pos);
      const key = pairKey(card.id, card.ru ?? [], listed);
      const translation = translations[key];
      const pair = byKey.get(key);
      if (!translation?.word || !pair) {
        missing += 1;
        continue;
      }
      const part = listed || validPos(translation.pos);
      const slug = slugHead(translation.word);
      const gloss = normalizeRu(card.ru ?? []);
      const mergeKey = `${slug}\t${gloss}`;
      const existing = index.get(mergeKey);
      if (existing) {
        if (!existing.sourceIds.includes(card.id)) existing.sourceIds.push(card.id);
        existing.sourceId = existing.sourceIds[0] ?? existing.sourceId;
        continue;
      }
      const taken = words.find((item) => item.id === slug && item.word.toLowerCase() !== translation.word.toLowerCase());
      const id = taken ? `${slug}-${card.id}` : slug;
      const sameFrenchDifferentGloss = words.find(
        (item) => item.word.toLowerCase() === translation.word.toLowerCase() && normalizeRu(item.ru) !== gloss,
      );
      if (sameFrenchDifferentGloss) {
        mergeNotes.push(`${theme.id}: kept both «${translation.word}» from ${sameFrenchDifferentGloss.sourceId} and ${card.id}`);
      }
      const built: BuiltCard = {
        id,
        word: translation.word,
        en: translation.word,
        sourceId: card.id,
        sourceIds: [card.id],
        ru: card.ru ?? [],
        gender: part === "n" ? translation.gender : null,
        example: translation.example || "",
        level: card.level || pair.level || "B1",
        pos: part,
      };
      words.push(built);
      index.set(mergeKey, built);
      builtCards += 1;
    }
    await writeJson(join(target, "themes", name), {
      id: theme.id,
      title: theme.title,
      paid: theme.paid ?? false,
      blockId: theme.blockId,
      words,
    });
  }

  await copyFile(join(source, "blocks.json"), join(target, "blocks.json"));
  await writeJson(cachePath("theme-build-report.json"), { themes: themeNames.length, builtCards, missing, mergeNotes });
  console.info(`themes ${themeNames.length}, cards ${builtCards}, missing translations ${missing}, merge notes ${mergeNotes.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
