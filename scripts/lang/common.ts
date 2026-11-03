import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

export interface Pair {
  key: string;
  id: string;
  en: string;
  ru: string[];
  pos: string;
  level: string;
  example: string;
  themes: string[];
  packs: string[];
}

export const WORD_POS = [
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
] as const;

export type WordPosCode = (typeof WORD_POS)[number];

const WORD_POS_SET = new Set<string>(WORD_POS);

export function validPos(value: unknown): WordPosCode | "" {
  return typeof value === "string" && WORD_POS_SET.has(value) ? (value as WordPosCode) : "";
}

export interface Translation {
  word: string;
  gender: "m" | "f" | "n" | null;
  example: string;
  note: string | null;
  pos?: WordPosCode;
}

export function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

export function langCode(): string {
  return (arg("lang") ?? "fr").toLowerCase();
}

export function langRoot(lang = langCode()): string {
  return join(repoRoot, "data", lang);
}

export function cachePath(name: string, lang = langCode()): string {
  return join(langRoot(lang), ".cache", name);
}

export function normalizeRu(ru: string[]): string {
  return [...ru]
    .map((item) => item.trim().toLowerCase().replace(/ё/g, "е"))
    .filter(Boolean)
    .sort()
    .join("|");
}

export function pairKey(id: string, ru: string[], pos: string): string {
  return `${id}\t${normalizeRu(ru)}\t${pos}`;
}

export function slugHead(value: string): string {
  const folded = value.normalize("NFD").replace(/\p{M}/gu, "");
  return folded.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "word";
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function easierLevel(a: string, b: string): string {
  const ai = LEVELS.indexOf(a);
  const bi = LEVELS.indexOf(b);
  if (ai === -1) return b || a;
  if (bi === -1) return a;
  return ai <= bi ? a : b;
}
