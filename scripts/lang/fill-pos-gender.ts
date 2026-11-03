import { geminiGenerateJson } from "../../packages/api/src/ai.js";
import {
  cachePath,
  langCode,
  normalizeRu,
  readJson,
  validPos,
  writeJson,
  type Pair,
  type Translation,
  type WordPosCode,
} from "./common.js";

type Gender = NonNullable<Translation["gender"]>;

interface Gap {
  id: string;
  french: string;
  en: string;
  ru: string[];
  keys: string[];
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          gender: { type: "STRING" },
        },
        required: ["id", "gender"],
      },
    },
  },
  required: ["items"],
};

function asGender(raw: unknown): Gender | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "m" || value === "f" || value === "n") return value;
  if (value.startsWith("masc")) return "m";
  if (value.startsWith("fem")) return "f";
  if (value.startsWith("neu")) return "n";
  return null;
}

function hasGender(value: unknown): value is Gender {
  return value === "m" || value === "f" || value === "n";
}

function frenchOf(entry: Translation | undefined): string {
  return String(entry?.word ?? "").trim().toLowerCase();
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function askGenders(items: Gap[]): Promise<Map<string, Gender>> {
  const payload = await geminiGenerateJson({
    system:
      "You assign grammatical gender to French dictionary nouns. " +
      "The user message is JSON with items: id, french (no article), en, and ru (the Russian sense). " +
      "Return JSON {\"items\":[{\"id\":\"...\",\"gender\":\"m\"|\"f\"|\"n\"|\"\"}]}. " +
      "m is masculine, f is feminine, n is for a noun with no grammatical gender. " +
      "Use the Russian sense. If this French form is not a noun in that sense, return an empty string. " +
      "Return one item for every input id. Do not translate.",
    user: JSON.stringify({
      items: items.map((item) => ({ id: item.id, french: item.french, en: item.en, ru: item.ru })),
    }),
    schema: SCHEMA,
  });
  const rows = payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
    ? (payload as { items: unknown[] }).items
    : [];
  const out = new Map<string, Gender>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { id?: unknown; gender?: unknown };
    const gender = asGender(record.gender);
    if (!gender) continue;
    out.set(String(record.id ?? ""), gender);
  }
  return out;
}

async function askGendersRetry(items: Gap[]): Promise<Map<string, Gender>> {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await askGenders(items);
    } catch (error) {
      last = error;
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 0;
      const message = error instanceof Error ? error.message : "";
      const retry = status === 429 || status >= 500 || /network|fetch|timed out|ECONN|socket/i.test(message);
      if (!retry || attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function nounGaps(pairs: Pair[], cache: Record<string, Translation>): Gap[] {
  const pending = new Map<string, Gap>();
  for (const pair of pairs) {
    const entry = cache[pair.key];
    if (!entry || validPos(entry.pos) !== "n" || hasGender(entry.gender)) continue;
    const groupKey = `${frenchOf(entry)}\t${normalizeRu(pair.ru)}\t${pair.en.toLowerCase()}`;
    const existing = pending.get(groupKey);
    if (existing) {
      existing.keys.push(pair.key);
      continue;
    }
    pending.set(groupKey, {
      id: String(pending.size),
      french: entry.word,
      en: pair.en,
      ru: pair.ru,
      keys: [pair.key],
    });
  }
  return [...pending.values()];
}

function applyGenders(cache: Record<string, Translation>, items: Gap[], found: Map<string, Gender>): number {
  let filled = 0;
  for (const item of items) {
    const gender = found.get(item.id);
    if (!gender) continue;
    for (const key of item.keys) {
      const entry = cache[key];
      if (!entry || hasGender(entry.gender) || validPos(entry.pos) !== "n") continue;
      entry.gender = gender;
      filled += 1;
    }
  }
  return filled;
}

async function main() {
  const language = langCode();
  if (language !== "fr") console.info(`lang ${language}`);
  const pairs = await readJson<Pair[]>(cachePath("pairs.json"), []);
  if (pairs.length === 0) throw new Error("pairs.json is empty");
  const cache = await readJson<Record<string, Translation>>(cachePath("translations.json"), {});

  const groups = new Map<string, Pair[]>();
  for (const pair of pairs) {
    const key = `${pair.id}\t${normalizeRu(pair.ru)}`;
    const list = groups.get(key) ?? [];
    list.push(pair);
    groups.set(key, list);
  }

  let fromOwn = 0;
  let fromSibling = 0;
  let differ = 0;
  let conflict = 0;
  let none = 0;

  for (const pair of pairs) {
    const entry = cache[pair.key];
    if (!entry) continue;
    const own = validPos(pair.pos);
    let part: WordPosCode | "" = own;
    if (part) {
      fromOwn += 1;
    } else {
      const tagged = (groups.get(`${pair.id}\t${normalizeRu(pair.ru)}`) ?? []).filter((item) => validPos(item.pos));
      const choices = new Set(tagged.map((item) => item.pos));
      if (choices.size === 1) {
        const mine = frenchOf(entry);
        const same = Boolean(mine) && tagged.every((item) => frenchOf(cache[item.key]) === mine);
        if (same) {
          part = validPos([...choices][0]);
          fromSibling += 1;
        } else differ += 1;
      } else if (choices.size > 1) conflict += 1;
      else none += 1;
    }
    if (part) entry.pos = part;
    else delete entry.pos;
  }

  let genderCopied = 0;
  for (const pair of pairs) {
    const entry = cache[pair.key];
    if (!entry || validPos(entry.pos) !== "n" || hasGender(entry.gender)) continue;
    const mine = frenchOf(entry);
    const genders = new Set<Gender>();
    for (const other of groups.get(`${pair.id}\t${normalizeRu(pair.ru)}`) ?? []) {
      if (other.key === pair.key) continue;
      const sibling = cache[other.key];
      if (!sibling || frenchOf(sibling) !== mine || !hasGender(sibling.gender)) continue;
      genders.add(sibling.gender);
    }
    if (genders.size !== 1) continue;
    entry.gender = [...genders][0] ?? null;
    genderCopied += 1;
  }

  const path = cachePath("translations.json");
  await writeJson(path, cache);
  console.info(`pos own ${fromOwn}, sibling ${fromSibling}, word differed ${differ}, conflict ${conflict}, no english pos ${none}`);
  console.info(`gender copied from sibling ${genderCopied}`);

  let fromGemini = 0;
  const ask = async (items: Gap[], label: string) => {
    for (const batch of chunks(items, 20)) {
      const found = await askGendersRetry(batch);
      const filled = applyGenders(cache, batch, found);
      fromGemini += filled;
      await writeJson(path, cache);
      console.info(`${label} ${filled}/${batch.length}`);
    }
  };

  const first = nounGaps(pairs, cache);
  console.info(`nouns still missing gender ${first.length}`);
  await ask(first, "gemini");
  const second = nounGaps(pairs, cache);
  if (second.length > 0) {
    console.info(`retry empty ${second.length}`);
    await ask(second, "retry");
  }

  const left = nounGaps(pairs, cache);
  console.info(`gender from gemini entries ${fromGemini}`);
  console.info(`gender still empty ${left.length}`);
  for (const item of left) {
    console.info(`empty gender: ${item.en} -> ${item.french} | ${item.ru.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
