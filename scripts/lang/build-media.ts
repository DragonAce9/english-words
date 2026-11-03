import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { geminiGenerateJson } from "../../packages/api/src/ai.js";
import {
  arg,
  cachePath,
  langCode,
  langRoot,
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

interface PackFile {
  id: string;
  title: string;
  paid?: boolean;
  blockId?: string;
  words?: Card[];
  [key: string]: unknown;
}

const POS = new Set(["n", "v", "adj", "adv", "numeral", "pronoun", "determiner", "preposition", "conjunction", "interjection"]);
const NAMES: Record<string, string> = { fr: "French", de: "German", es: "Spanish" };

async function translateLine(line: string, word: string, language: string): Promise<string> {
  const payload = await geminiGenerateJson({
    system:
      `Translate one short subtitle line into ${NAMES[language] ?? language}. ` +
      "Keep it one short sentence. The given dictionary word must appear in the sentence. Return JSON {\"line\":\"...\"}.",
    user: JSON.stringify({ line, word, language }),
    schema: {
      type: "OBJECT",
      properties: { line: { type: "STRING" } },
      required: ["line"],
    },
  });
  const text = payload && typeof payload === "object" ? String((payload as { line?: unknown }).line ?? "").trim() : "";
  if (!text) throw new Error("empty media line");
  return text;
}

async function main() {
  const language = langCode();
  const lineLimit = Number(arg("line-limit") ?? "0");
  const source = join(repoRoot, "data", "en", "media");
  const target = join(langRoot(), "media");
  const pairs = await readJson<Pair[]>(cachePath("pairs.json"), []);
  const byKey = new Map(pairs.map((pair) => [pair.key, pair]));
  const translations = await readJson<Record<string, Translation>>(cachePath("translations.json"), {});
  const lines = await readJson<Record<string, string>>(cachePath("media-lines.json"), {});
  const pos = await readJson<Record<string, string>>(join(repoRoot, "data", "en", "word-pos.json"), {});
  const names = (await readdir(source)).filter((name) => name.endsWith(".json"));
  await mkdir(target, { recursive: true });

  let translatedLines = 0;
  let cards = 0;
  let sourceCards = 0;
  const countNotes: string[] = [];

  for (const name of names) {
    const pack = JSON.parse(await readFile(join(source, name), "utf8")) as PackFile;
    const words = [];
    for (const card of pack.words ?? []) {
      sourceCards += 1;
      const tagged = pos[`${pack.id}\t${card.id}`];
      const listed = card.pos && POS.has(card.pos) ? card.pos : tagged && POS.has(tagged) ? tagged : "";
      const key = pairKey(card.id, card.ru ?? [], listed);
      const pair = byKey.get(key);
      const translation = translations[key];
      if (!pair || !translation?.word) continue;
      const part = listed || validPos(translation.pos);
      const englishLine = (card.example ?? "").trim();
      let example = translation.example || "";
      let exampleTranslated = false;
      if (englishLine) {
        const lineKey = `${language}\t${englishLine}`;
        if (!lines[lineKey] && (lineLimit === 0 || translatedLines < lineLimit)) {
          try {
            lines[lineKey] = await translateLine(englishLine, translation.word, language);
            translatedLines += 1;
            if (translatedLines % 5 === 0) await writeJson(cachePath("media-lines.json"), lines);
          } catch (error) {
            console.error(`line skipped: ${error instanceof Error ? error.message : error}`);
          }
        }
        if (lines[lineKey]) {
          example = lines[lineKey];
          exampleTranslated = true;
        }
      }
      words.push({
        id: slugHead(translation.word),
        word: translation.word,
        en: translation.word,
        sourceId: card.id,
        ru: card.ru ?? [],
        gender: part === "n" ? translation.gender : null,
        example,
        exampleTranslated,
        level: card.level || pair.level,
        pos: part,
      });
      cards += 1;
    }
    if (words.length !== (pack.words ?? []).length) {
      countNotes.push(`${pack.id}: ${pack.words?.length ?? 0} -> ${words.length}`);
    }
    const { words: _words, ...meta } = pack;
    await writeJson(join(target, name), { ...meta, words });
  }

  await writeJson(cachePath("media-lines.json"), lines);
  await writeJson(cachePath("media-build-report.json"), {
    packs: names.length,
    sourceCards,
    cards,
    translatedLines,
    countNotes: countNotes.slice(0, 50),
    countNoteTotal: countNotes.length,
  });
  console.info(`packs ${names.length}, source cards ${sourceCards}, built cards ${cards}, new lines ${translatedLines}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
