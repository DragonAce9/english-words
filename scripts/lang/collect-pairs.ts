import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cachePath, easierLevel, langRoot, normalizeRu, pairKey, readJson, repoRoot, writeJson, type Pair } from "./common.js";

interface Card {
  id?: string;
  en?: string;
  ru?: string[];
  example?: string;
  level?: string;
  pos?: string;
}

interface ThemeFile {
  id?: string;
  words?: Card[];
  kind?: string;
}

const POS = new Set(["n", "v", "adj", "adv", "numeral", "pronoun", "determiner", "preposition", "conjunction", "interjection"]);

async function main() {
  const source = join(repoRoot, "data", "en");
  const pos = await readJson<Record<string, string>>(join(source, "word-pos.json"), {});
  const pairs = new Map<string, Pair>();
  let cards = 0;

  async function walk(dir: string, kind: "theme" | "pack") {
    let names: string[] = [];
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    for (const name of names) {
      const theme = JSON.parse(await readFile(join(dir, name), "utf8")) as ThemeFile;
      const themeId = theme.id || name.replace(/\.json$/, "");
      for (const word of theme.words ?? []) {
        if (!word.id || !word.en) continue;
        cards += 1;
        const listed = typeof word.pos === "string" && POS.has(word.pos) ? word.pos : "";
        const tagged = pos[`${themeId}\t${word.id}`];
        const part = listed || (tagged && POS.has(tagged) ? tagged : "");
        const key = pairKey(word.id, word.ru ?? [], part);
        const existing = pairs.get(key);
        const example = (word.example ?? "").trim();
        if (!existing) {
          pairs.set(key, {
            key,
            id: word.id,
            en: word.en,
            ru: word.ru ?? [],
            pos: part,
            level: word.level || "B1",
            example,
            themes: kind === "theme" ? [themeId] : [],
            packs: kind === "pack" ? [themeId] : [],
          });
          continue;
        }
        existing.level = easierLevel(existing.level, word.level || existing.level);
        if (!existing.example && example) existing.example = example;
        const list = kind === "theme" ? existing.themes : existing.packs;
        if (!list.includes(themeId)) list.push(themeId);
      }
    }
  }

  await walk(join(source, "themes"), "theme");
  await walk(join(source, "media"), "pack");

  const list = [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key));
  await writeJson(cachePath("pairs.json"), list);

  const byId = new Map<string, number>();
  for (const pair of list) byId.set(pair.id, (byId.get(pair.id) ?? 0) + 1);
  const multi = [...byId.entries()].filter(([, count]) => count > 1);

  console.info(`cards ${cards}`);
  console.info(`unique pairs ${list.length}`);
  console.info(`ids with more than one meaning ${multi.length}`);
  const cock = list.filter((pair) => pair.id === "cock");
  console.info(`cock pairs ${cock.length}: ${cock.map((pair) => normalizeRu(pair.ru)).join(" ; ")}`);
  console.info(`wrote ${cachePath("pairs.json")}`);
  void langRoot;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
