import { geminiGenerateJson } from "../../packages/api/src/ai.js";
import { arg, cachePath, langCode, readJson, validPos, writeJson, type Pair, type Translation } from "./common.js";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    word: { type: "STRING" },
    gender: { type: "STRING" },
    example: { type: "STRING" },
    note: { type: "STRING" },
  },
  required: ["word", "example"],
};

const NAMES: Record<string, string> = {
  fr: "French",
  de: "German",
  es: "Spanish",
};

function systemPrompt(language: string): string {
  const name = NAMES[language] ?? language;
  return (
    `You translate one vocabulary card into ${name} for a learner dictionary. ` +
    "The user message has the English headword, the Russian meaning, the part of speech, and an English example. " +
    "Return JSON only. word is the dictionary form in the target language with no article. " +
    "gender is m, f, or n for nouns and an empty string otherwise. " +
    "example is one short sentence in the target language that contains word. " +
    "note is a short remark when the meaning is ambiguous, otherwise an empty string. " +
    "Do not copy the English word unless the target language uses that same form."
  );
}

function asGender(raw: unknown): Translation["gender"] {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "m" || value === "f" || value === "n") return value;
  if (value.startsWith("masc")) return "m";
  if (value.startsWith("fem")) return "f";
  if (value.startsWith("neu")) return "n";
  return null;
}

function parseTranslation(payload: unknown): Translation | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const word = String(row.word ?? "").trim();
  if (!word) return null;
  const note = String(row.note ?? "").trim();
  return {
    word,
    gender: asGender(row.gender),
    example: String(row.example ?? "").trim(),
    note: note || null,
  };
}

async function translateOne(pair: Pair, language: string): Promise<Translation> {
  const payload = await geminiGenerateJson({
    system: systemPrompt(language),
    user: JSON.stringify({
      language,
      en: pair.en,
      ru: pair.ru,
      pos: pair.pos || null,
      example: pair.example || null,
    }),
    schema: SCHEMA,
  });
  const parsed = parseTranslation(payload);
  if (!parsed) throw new Error(`empty translation for ${pair.key}`);
  const pos = validPos(pair.pos);
  if (pos) parsed.pos = pos;
  return parsed;
}

async function withRetry(pair: Pair, language: string): Promise<Translation> {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await translateOne(pair, language);
    } catch (error) {
      last = error;
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 0;
      const message = error instanceof Error ? error.message : "";
      const retry = status === 429 || status >= 500 || /network|fetch|timed out|ECONN|socket|empty translation/i.test(message);
      if (!retry || attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return out;
}

async function main() {
  const language = langCode();
  const limit = Number(arg("limit") ?? "0");
  const pairs = await readJson<Pair[]>(cachePath("pairs.json"), []);
  if (pairs.length === 0) throw new Error("pairs.json is empty; run collect-pairs first");
  const cache = await readJson<Record<string, Translation>>(cachePath("translations.json"), {});
  const pending = pairs.filter((pair) => !cache[pair.key]);
  const batch = limit > 0 ? pending.slice(0, limit) : pending;
  console.info(`pairs ${pairs.length}, cached ${pairs.length - pending.length}, translating ${batch.length}`);

  let done = 0;
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    const snapshot = { ...cache };
    saving = saving.then(() => writeJson(cachePath("translations.json"), snapshot));
    return saving;
  };
  let skipped = 0;
  await mapPool(batch, 3, async (pair) => {
    let translation: Translation;
    try {
      translation = await withRetry(pair, language);
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 0;
      const message = error instanceof Error ? error.message : String(error);
      const fatal = status === 401 || status === 403 || status === 429 || status >= 500;
      if (fatal) {
        await save();
        throw error;
      }
      skipped += 1;
      console.error(`skipped ${pair.key}: ${message}`);
      return;
    }
    cache[pair.key] = translation;
    done += 1;
    if (done % 5 === 0 || done === batch.length) {
      await save();
      console.info(`cached ${done}/${batch.length}`);
    }
  });
  if (skipped > 0) console.info(`skipped ${skipped}`);
  await save();

  const translated = pairs.filter((pair) => cache[pair.key]);
  const empty = translated.filter((pair) => !cache[pair.key]?.word);
  const same = translated.filter((pair) => cache[pair.key]?.word.toLowerCase() === pair.en.toLowerCase());
  const notes = translated.filter((pair) => cache[pair.key]?.note);
  const byFrench = new Map<string, Set<string>>();
  for (const pair of translated) {
    const word = cache[pair.key]?.word.toLowerCase();
    if (!word) continue;
    const ids = byFrench.get(word) ?? new Set<string>();
    ids.add(pair.id);
    byFrench.set(word, ids);
  }
  const collisions = [...byFrench.entries()].filter(([, ids]) => ids.size > 1);

  console.info(`empty ${empty.length}`);
  console.info(`same as english ${same.length}`);
  console.info(`shared french word across english ids ${collisions.length}`);
  console.info(`notes ${notes.length}`);
  if (collisions.length > 0) {
    console.info(
      collisions
        .slice(0, 20)
        .map(([word, ids]) => `${word}: ${[...ids].join(", ")}`)
        .join("\n"),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
