import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { activeLanguage } from "./catalogContext.js";
import { config } from "./config.js";
import type { WordGender, WordPos } from "./types.js";

/** Shown on a card whose gloss and example come from Wiktionary. */
export const WIKTIONARY_SOURCE = "Викисловарь, CC BY-SA";

export interface WikiEntry {
  word: string;
  ru: string[];
  pos?: WordPos;
  example: string;
  gender?: WordGender;
}

const POS: ReadonlySet<string> = new Set([
  "n",
  "v",
  "adj",
  "adv",
  "numeral",
  "pronoun",
  "determiner",
  "preposition",
  "conjunction",
  "interjection",
]);

const GENDERS: ReadonlySet<string> = new Set(["m", "f", "n", "m/f"]);

interface WikiIndex {
  lemmas: Map<string, WikiEntry>;
  forms: Map<string, string>;
}

const indexes = new Map<string, WikiIndex>();
let lookupOverride: ((query: string, language: string) => WikiEntry | null) | null = null;

export function wiktionaryDir(): string {
  return process.env.WIKTIONARY_DIR ?? resolve(config.dictionaryDir, "../wiktionary");
}

/** Same folding as scripts/import-wiktionary.py. */
export function foldWikiKey(value: string): string {
  const folded = value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/ß/g, "ss")
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "");
  return folded
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugHead(value: string): string {
  const folded = value.replace(/ß/g, "ss").replace(/đ/g, "dj").normalize("NFD").replace(/\p{M}/gu, "");
  return folded.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "word";
}

function asPos(value: string): WordPos | undefined {
  return POS.has(value) ? (value as WordPos) : undefined;
}

function asGender(value: string): WordGender | undefined {
  return GENDERS.has(value) ? (value as WordGender) : undefined;
}

export function parseLemmaLine(line: string): { key: string; entry: WikiEntry } | null {
  const [key, word, pos, gender, ru, example] = line.split("\t");
  if (!key || !word || !ru) return null;
  const glosses = ru
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (glosses.length === 0) return null;
  return {
    key,
    entry: {
      word,
      ru: glosses,
      pos: asPos(pos ?? ""),
      gender: asGender(gender ?? ""),
      example: example ?? "",
    },
  };
}

export function buildWiktionaryIndex(lemmaLines: string[], formLines: string[] = []): WikiIndex {
  const lemmas = new Map<string, WikiEntry>();
  const forms = new Map<string, string>();
  for (const line of lemmaLines) {
    const parsed = parseLemmaLine(line.trim());
    if (!parsed || lemmas.has(parsed.key)) continue;
    lemmas.set(parsed.key, parsed.entry);
  }
  for (const line of formLines) {
    const [form, lemma] = line.trim().split("\t");
    if (!form || !lemma || form === lemma || !lemmas.has(lemma) || forms.has(form)) continue;
    forms.set(form, lemma);
  }
  return { lemmas, forms };
}

export function searchWiktionaryIndex(index: WikiIndex, query: string): WikiEntry | null {
  const key = foldWikiKey(query);
  if (key.length < 2) return null;
  const direct = index.lemmas.get(key);
  if (direct) return direct;
  const lemma = index.forms.get(key);
  if (!lemma) return null;
  return index.lemmas.get(lemma) ?? null;
}

function readIndex(language: string): WikiIndex {
  const cached = indexes.get(language);
  if (cached) return cached;
  const dir = wiktionaryDir();
  const lemmaPath = resolve(dir, `${language}.tsv`);
  const formPath = resolve(dir, `${language}.forms.tsv`);
  const lemmaLines = existsSync(lemmaPath) ? readFileSync(lemmaPath, "utf8").split("\n") : [];
  const formLines = existsSync(formPath) ? readFileSync(formPath, "utf8").split("\n") : [];
  const index = buildWiktionaryIndex(lemmaLines, formLines);
  indexes.set(language, index);
  return index;
}

export function setWiktionaryLookup(fn: ((query: string, language: string) => WikiEntry | null) | null): void {
  lookupOverride = fn;
}

export function lookupWiktionary(query: string, language = activeLanguage()): WikiEntry | null {
  if (lookupOverride) return lookupOverride(query, language);
  if (process.env.VITEST) return null;
  return searchWiktionaryIndex(readIndex(language), query);
}
