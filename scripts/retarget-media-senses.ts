import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dictionary } from "../packages/api/src/dictionary.js";
import {
  catalogSenses,
  clipSentence,
  resolveSenses,
  sentenceMissesSenses,
  sentencesContaining,
  splitSentences,
  type SenseHit,
} from "../packages/api/src/senses.js";
import { parseSubtitle } from "../packages/api/src/subtitles.js";
import type { DictWord } from "../packages/api/src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const mediaDir = resolve(root, "data/en/media");
const sourceDir = resolve(root, "data/source/media");

interface MediaWord {
  id: string;
  en: string;
  ru: string[];
  example: string;
  level: DictWord["level"];
}

function srtPath(id: string): string | null {
  for (const name of [`${id}.en.srt`, `${id}-en.srt`]) {
    const path = join(sourceDir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))] as T);
  return [...new Set(out)];
}

async function main() {
  await dictionary.load();
  const files = (await readdir(mediaDir)).filter((name) => name.endsWith(".json")).sort();
  let changedPacks = 0;
  let changedCards = 0;
  const skipped: string[] = [];
  const samples: string[] = [];

  for (const file of files) {
    const path = join(mediaDir, file);
    const pack = JSON.parse(await readFile(path, "utf8")) as { id: string; words: MediaWord[] };
    const srt = srtPath(pack.id);
    if (!srt) {
      skipped.push(pack.id);
      continue;
    }
    const script = parseSubtitle(await readFile(srt, "utf8"));
    const sentences = splitSentences(script);
    type Slot =
      | { kind: "keep"; word: MediaWord }
      | { kind: "pick"; word: MediaWord; senses: DictWord[]; lines: string[] };
    const slots: Slot[] = [];
    for (const word of pack.words) {
      const senses = catalogSenses(word.en);
      const lines = sampleEvenly(sentencesContaining(sentences, word.en), 8).map(clipSentence);
      if (senses.length <= 1 || lines.length === 0) slots.push({ kind: "keep", word });
      else slots.push({ kind: "pick", word, senses, lines });
    }
    const hits: SenseHit[] = slots.flatMap((slot) =>
      slot.kind === "pick" ? slot.lines.map((sentence) => ({ token: slot.word.en, sentence, senses: slot.senses })) : [],
    );
    if (hits.length > 0) console.info(`${pack.id}: ${hits.length} lines`);
    const picked = hits.length > 0 ? await resolveSenses(hits) : [];
    const next: MediaWord[] = [];
    const seen = new Set<string>();
    let cursor = 0;
    let packChanged = false;
    const push = (word: MediaWord) => {
      if (seen.has(word.id)) return;
      seen.add(word.id);
      next.push(word);
    };
    for (const slot of slots) {
      if (slot.kind === "keep") {
        push(slot.word);
        continue;
      }
      const chosen = new Map<string, { sense: DictWord; sentence: string }>();
      for (const sentence of slot.lines) {
        const sense = picked[cursor];
        cursor += 1;
        if (!sense) continue;
        if (!chosen.has(sense.id)) chosen.set(sense.id, { sense, sentence });
      }
      const missed = slot.lines.filter((sentence) => sentenceMissesSenses(sentence, slot.word.en)).length;
      if (chosen.size === 0) {
        if (missed === slot.lines.length) {
          packChanged = true;
          changedCards += 1;
          if (samples.length < 12) samples.push(`${pack.id}\t${slot.word.id} → —\tнет такого значения в каталоге`);
        } else {
          push(slot.word);
        }
        continue;
      }
      for (const { sense, sentence } of chosen.values()) {
        const entry: MediaWord = {
          id: sense.id,
          en: sense.en,
          ru: sense.ru,
          example: sentence || slot.word.example,
          level: sense.level,
        };
        if (entry.id !== slot.word.id) {
          packChanged = true;
          changedCards += 1;
          if (samples.length < 12) {
            samples.push(`${pack.id}\t${slot.word.id} → ${entry.id}\t${entry.ru.join(", ")}\t${sentence}`);
          }
        }
        push(entry);
      }
    }
    if (!packChanged && next.length === pack.words.length) {
      console.info(`${pack.id}: same senses`);
      continue;
    }
    pack.words = next;
    await writeFile(path, `${JSON.stringify(pack, null, 2)}\n`);
    changedPacks += 1;
    console.info(`${pack.id}: ${pack.words.length} words`);
  }

  console.info(
    JSON.stringify({ changedPacks, changedCards, skipped: skipped.length, skippedIds: skipped }, null, 2),
  );
  for (const line of samples) console.info(line);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
