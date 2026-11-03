import { defineDictionaryWord, type DefinedWord } from "./ai.js";
import { fileCatalogLemma } from "./catalog.js";
import { lookupWiktionary, slugHead, WIKTIONARY_SOURCE, type WikiEntry } from "./wiktionary.js";
import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { targetHead } from "./languages.js";
import { dictionary } from "./dictionary.js";
import { catalogSenses } from "./senses.js";
import type { AppUser, CefrLevel, DictWord, WordPos } from "./types.js";
import { studyWordIds } from "./studyWords.js";
import { isCefr, slugWord } from "./userWords.js";

export interface DictionaryHit {
  id: string;
  word?: string;
  en: string;
  gender?: "m" | "f" | "n" | "m/f";
  ru: string[];
  example: string;
  level: CefrLevel;
  pos?: WordPos;
  themeId: string;
  themeTitle: string;
  /** Every catalog category that contains this word, in catalog order. */
  themes: { id: string; title: string }[];
  known: boolean;
  /** True when this user saved the word with «Учить». */
  studying: boolean;
  /** Infinitive, past, and participle when the card is an irregular verb. */
  forms?: [string, string, string];
  /** Set when the gloss comes from outside the app catalog. */
  source?: string;
}

export interface DictionarySearch {
  query: string;
  exact: boolean;
  added: boolean;
  corrected: boolean;
  hits: DictionaryHit[];
  /** Other catalog words from the same query: prefix matches or further spelling guesses. */
  alternatives: DictionaryHit[];
}

const POS_BY_NAME: Record<string, WordPos> = {
  n: "n",
  noun: "n",
  v: "v",
  verb: "v",
  adj: "adj",
  adjective: "adj",
  adv: "adv",
  adverb: "adv",
  numeral: "numeral",
  pronoun: "pronoun",
  determiner: "determiner",
  preposition: "preposition",
  conjunction: "conjunction",
  interjection: "interjection",
};

function cleanQuery(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{M}' -]/gu, "")
    .trim()
    .slice(0, 48);
}

function isCyrillic(query: string): boolean {
  return /[а-яё]/i.test(query) && !/[a-z]/i.test(query);
}

function headOf(en: string): string {
  return (en.split(/\s*\/\s*/)[0] ?? en).toLowerCase().replace(/\s+/g, " ").trim();
}

interface IrregularVerb {
  infinitive: string;
  forms: [string, string, string];
  wordId: string;
}

let irregularKey = "";
let irregularByForm = new Map<string, IrregularVerb[]>();

function formTokens(part: string): string[] {
  return part.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 2);
}

function irregularIndex(): Map<string, IrregularVerb[]> {
  const key = `${activeLanguage()}:${dictionary.revision}`;
  if (irregularKey === key) return irregularByForm;
  const index = new Map<string, IrregularVerb[]>();
  const theme = dictionary.getTheme("irregular-verbs");
  for (const word of theme?.words ?? []) {
    const parts = word.en.split(" / ").map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 3) continue;
    const forms: [string, string, string] = [parts[0]!, parts[1]!, parts[2]!];
    const infinitive = formTokens(forms[0])[0];
    if (!infinitive) continue;
    const entry: IrregularVerb = { infinitive, forms, wordId: word.id };
    for (const token of forms.flatMap(formTokens)) {
      const list = index.get(token) ?? [];
      if (!list.some((item) => item.wordId === entry.wordId)) list.push(entry);
      index.set(token, list);
    }
  }
  irregularByForm = index;
  irregularKey = key;
  return index;
}

function irregularVerbs(token: string): IrregularVerb[] {
  return irregularIndex().get(token.toLowerCase()) ?? [];
}

function verbSenses(lemma: string): DictWord[] {
  return catalogSenses(lemma).filter((word) => {
    const pos = dictionary.posFor(dictionary.resolveWordId(word.id));
    return !pos || pos === "v";
  });
}

function irregularCard(lemma: string): DictWord | undefined {
  return dictionary.getTheme("irregular-verbs")?.words.find((word) => headOf(word.en) === lemma);
}

/** Lemma cards for a principal part, so «went» opens the same verb as «go». */
function irregularMatches(token: string): DictWord[] {
  const out: DictWord[] = [];
  for (const verb of irregularVerbs(token)) {
    const senses = verbSenses(verb.infinitive);
    if (senses.length > 0) {
      out.push(...senses);
      continue;
    }
    const card = irregularCard(verb.infinitive);
    if (card) out.push(card);
  }
  return out;
}

function formsFor(word: DictWord): [string, string, string] | undefined {
  const head = headOf(word.en);
  const match = irregularVerbs(head).find((verb) => verb.infinitive === head);
  if (!match) return undefined;
  const pos = dictionary.posFor(dictionary.resolveWordId(word.id));
  if (pos && pos !== "v") return undefined;
  return match.forms;
}

function glossParts(ru: string[]): string[] {
  const parts: string[] = [];
  for (const item of ru) {
    for (const piece of item.split(/[,/]/)) {
      const clean = piece.toLowerCase().replace(/[()]/g, "").trim();
      if (clean) parts.push(clean);
    }
  }
  return parts;
}

function foldLatin(value: string): string {
  return value.replace(/ß/g, "ss").replace(/đ/g, "dj").normalize("NFD").replace(/\p{M}/gu, "");
}

/** Lemma and gloss text compared as a phrase: accents, ё, and apostrophes folded. */
function normalizePhrase(value: string): string {
  return foldLatin(value.toLowerCase().replace(/ё/g, "е"))
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseLabels(word: DictWord): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [word.en, targetHead(word), ...glossParts(word.ru)]) {
    const label = normalizePhrase(raw);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** 0 exact phrase, 1 prefix of the label, 2 the phrase occurs later in the label. */
function phraseScore(query: string, label: string): number | null {
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(` ${query}`)) return 2;
  return null;
}

/**
 * Multi-word queries match the whole phrase against the lemma and the gloss.
 * An exact phrase ranks ahead of a prefix or a later occurrence. Capped by the caller.
 */
function matchPhrases(query: string): DictWord[] {
  const q = normalizePhrase(query);
  if (!q.includes(" ")) return [];
  const ranked: { word: DictWord; score: number; label: string }[] = [];
  for (const word of dictionary.words.values()) {
    let best: { score: number; label: string } | null = null;
    for (const label of phraseLabels(word)) {
      const score = phraseScore(q, label);
      if (score === null) continue;
      if (!best || score < best.score || (score === best.score && label.length < best.label.length)) {
        best = { score, label };
      }
    }
    if (best) ranked.push({ word, score: best.score, label: best.label });
  }
  ranked.sort(
    (a, b) => a.score - b.score || a.label.length - b.label.length || a.label.localeCompare(b.label),
  );
  return unique(ranked.map((item) => item.word));
}

function unique(words: DictWord[]): DictWord[] {
  const seen = new Set<string>();
  const out: DictWord[] = [];
  for (const word of words) {
    const id = dictionary.resolveWordId(word.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(dictionary.getWord(id) ?? word);
  }
  return out;
}

function maxDistance(query: string): number {
  if (query.length < 4) return 0;
  if (query.length < 6) return 1;
  return 2;
}

function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const m = a.length;
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    const older = prev2;
    prev2 = prev;
    prev = curr;
    curr = older;
  }
  return prev[n] <= limit ? prev[n] : limit + 1;
}

function closestLabel(query: string, labels: string[], limit: number): number {
  let best = limit + 1;
  for (const label of labels) {
    if (!label || label[0] !== query[0]) continue;
    if (label.startsWith(query) || query.startsWith(label)) continue;
    const distance = editDistance(query, label, limit);
    if (distance < best) best = distance;
  }
  return best;
}

function similar(query: string): DictWord[] {
  const q = query.toLowerCase();
  const limit = maxDistance(q);
  if (limit === 0) return [];
  const cyrillic = isCyrillic(q);
  const ranked: { word: DictWord; distance: number }[] = [];
  for (const word of dictionary.words.values()) {
    const labels = cyrillic ? glossParts(word.ru) : [headOf(word.en)];
    const distance = closestLabel(q, labels, limit);
    if (distance <= limit) ranked.push({ word, distance });
  }
  ranked.sort(
    (a, b) => a.distance - b.distance || headOf(a.word.en).length - headOf(b.word.en).length,
  );
  return unique(ranked.map((item) => item.word)).slice(0, 5);
}

function pickCorrection(query: string, words: DictWord[]): DictWord | null {
  if (words.length === 0) return null;
  const q = query.toLowerCase();
  const limit = maxDistance(q);
  const cyrillic = isCyrillic(q);
  const distanceOf = (word: DictWord) =>
    closestLabel(q, cyrillic ? glossParts(word.ru) : [headOf(word.en)], limit);
  const best = distanceOf(words[0]);
  const next = words[1] ? distanceOf(words[1]) : best + 1;
  return best < next ? words[0] : null;
}

function collect(query: string): { exact: DictWord[]; prefix: DictWord[] } {
  const q = query.toLowerCase();
  if (q.length < 2) return { exact: [], prefix: [] };
  if (q.includes(" ")) {
    const phrases = matchPhrases(q);
    if (phrases.length > 0) return { exact: phrases.slice(0, 12), prefix: [] };
  }
  if (isCyrillic(q)) {
    const exact: DictWord[] = [...catalogSenses(q)];
    const prefix: DictWord[] = [];
    for (const word of dictionary.words.values()) {
      const glosses = glossParts(word.ru);
      if (glosses.some((gloss) => gloss === q)) exact.push(word);
      else if (glosses.some((gloss) => gloss.startsWith(q))) prefix.push(word);
    }
    return { exact: unique(exact).slice(0, 12), prefix: unique(prefix).slice(0, 8) };
  }
  const senses = unique([...catalogSenses(q), ...irregularMatches(q)]);
  if (senses.length > 0) {
    const pastForm = irregularVerbs(q).some((verb) => verb.infinitive !== q);
    if (!pastForm) return { exact: senses, prefix: [] };
    const ranked = [...senses].sort((a, b) => Number(formsFor(b) != null) - Number(formsFor(a) != null));
    return { exact: ranked, prefix: [] };
  }
  const prefix: DictWord[] = [];
  for (const word of dictionary.words.values()) {
    if (headOf(word.en).startsWith(q)) prefix.push(word);
  }
  prefix.sort(
    (a, b) => headOf(a.en).length - headOf(b.en).length || headOf(a.en).localeCompare(headOf(b.en)),
  );
  return { exact: [], prefix: unique(prefix).slice(0, 8) };
}

async function knownIds(userId: string, words: DictWord[]): Promise<Set<string>> {
  const ids = words.map((word) => dictionary.resolveWordId(word.id));
  if (ids.length === 0) return new Set();
  const rows = await sql<{ word_id: string }[]>`
    SELECT word_id FROM word_progress
    WHERE user_id = ${userId}::bigint AND language = ${activeLanguage()} AND status = 'known' AND word_id = ANY(${ids})
  `;
  return new Set(rows.map((row) => dictionary.resolveWordId(row.word_id)));
}

function present(word: DictWord, known: Set<string>, studying: Set<string>): DictionaryHit {
  const id = dictionary.resolveWordId(word.id);
  const stored = dictionary.getWord(id) ?? word;
  const catalog = dictionary.catalogThemesFor(id);
  const themeId = catalog[0]?.id ?? dictionary.themesFor(id)[0] ?? "general";
  const theme = catalog[0] ?? dictionary.getTheme(themeId);
  const themes =
    catalog.length > 0
      ? catalog.map((item) => ({ id: item.id, title: item.title }))
      : [{ id: themeId, title: theme?.title ?? themeId }];
  const head = targetHead(stored);
  return {
    id,
    word: head,
    en: stored.en || head,
    gender: stored.gender,
    ru: dictionary.catalogGlosses(id),
    example: stored.example,
    level: stored.level,
    pos: dictionary.posFor(id),
    themeId,
    themeTitle: themes[0]?.title ?? themeId,
    themes,
    known: known.has(id),
    studying: studying.has(id),
    forms: formsFor(stored),
    source: stored.source,
  };
}

function sameWord(a: DictWord, b: DictWord): boolean {
  return dictionary.resolveWordId(a.id) === dictionary.resolveWordId(b.id);
}

function without(words: DictWord[], skip: DictWord[]): DictWord[] {
  return words.filter((word) => !skip.some((item) => sameWord(item, word)));
}

function sensesOf(word: DictWord): DictWord[] {
  const senses = catalogSenses(headOf(word.en));
  return senses.length > 0 ? senses : [word];
}

async function pack(
  query: string,
  words: DictWord[],
  exact: boolean,
  added: boolean,
  corrected: boolean,
  user: AppUser,
  alternatives: DictWord[] = [],
): Promise<DictionarySearch> {
  const listed = [...words, ...alternatives];
  const [known, studying] = await Promise.all([
    knownIds(user.id, listed),
    studyWordIds(user.id, listed.map((word) => dictionary.resolveWordId(word.id))),
  ]);
  return {
    query,
    exact,
    added,
    corrected,
    hits: words.map((word) => present(word, known, studying)),
    alternatives: alternatives.map((word) => present(word, known, studying)),
  };
}

export async function searchDictionary(user: AppUser, raw: string): Promise<DictionarySearch> {
  const query = cleanQuery(raw);
  const found = collect(query);
  if (found.exact.length > 0) return pack(query, found.exact, true, false, false, user);
  const close = without(similar(query), found.prefix);
  if (found.prefix.length > 0) return pack(query, found.prefix, false, false, false, user, close);
  return pack(query, close, false, false, close.length > 0, user);
}

function wordFromDefinition(defined: DefinedWord): DictWord {
  return {
    id: slugWord(defined.en),
    en: defined.en,
    ru: defined.ru,
    example: defined.example,
    level: isCefr(defined.level) ? defined.level : "B1",
    pos: defined.pos ? POS_BY_NAME[defined.pos] : undefined,
  };
}

function wordFromWiktionary(entry: WikiEntry): DictWord {
  return {
    id: slugHead(entry.word),
    en: entry.word,
    word: entry.word,
    ru: entry.ru.slice(0, 3),
    example: entry.example,
    level: "B1",
    pos: entry.pos,
    gender: entry.gender,
    source: WIKTIONARY_SOURCE,
  };
}

async function publishWiktionary(
  user: AppUser,
  query: string,
  entry: WikiEntry,
  alternatives: DictWord[],
): Promise<DictionarySearch> {
  const created = wordFromWiktionary(entry);
  const senses = catalogSenses(entry.word);
  const existing = senses.length > 0 ? senses : dictionary.getWord(created.id);
  const corrected = foldLatin(query.toLowerCase()) !== foldLatin(entry.word.toLowerCase());
  if (Array.isArray(existing) && existing.length > 0) {
    return pack(query, existing, true, false, corrected, user, without(alternatives, existing));
  }
  if (existing && !Array.isArray(existing)) {
    return pack(query, [existing], true, false, corrected, user, without(alternatives, [existing]));
  }
  const published = await fileCatalogLemma(created, "search");
  const stored = dictionary.getWord(created.id) ?? created;
  return pack(query, [stored], true, published.inserted, corrected, user, without(alternatives, [stored]));
}

export async function lookupDictionary(user: AppUser, raw: string): Promise<DictionarySearch> {
  const query = cleanQuery(raw);
  const found = collect(query);
  if (found.exact.length > 0) return pack(query, found.exact, true, false, false, user);
  if (query.length < 2) return pack(query, [], false, false, false, user);
  const related = without([...found.prefix, ...similar(query)], []);
  if (!isCyrillic(query)) {
    const entry = lookupWiktionary(query);
    if (entry) return publishWiktionary(user, query, entry, related);
  }
  if (found.prefix.length === 0) {
    const close = similar(query);
    const picked = pickCorrection(query, close);
    if (picked) {
      const senses = sensesOf(picked);
      return pack(query, senses, true, false, true, user, without(close, senses));
    }
    if (close.length > 0) return pack(query, close, false, false, true, user);
  }
  if (activeLanguage() !== "en") {
    return pack(query, found.prefix, false, false, false, user, without(related, found.prefix));
  }
  const defined = await defineDictionaryWord(query);
  if (!defined) return pack(query, found.prefix, false, false, false, user, without(related, found.prefix));
  const spellingFixed = !isCyrillic(query) && headOf(defined.en) !== query.toLowerCase();
  const already = catalogSenses(defined.en);
  const existing = already[0] ? already : dictionary.getWord(slugWord(defined.en));
  if (Array.isArray(existing) && existing.length > 0) {
    return pack(query, existing, true, false, spellingFixed, user, without(related, existing));
  }
  if (existing && !Array.isArray(existing)) {
    return pack(query, [existing], true, false, spellingFixed, user, without(related, [existing]));
  }
  const created = wordFromDefinition(defined);
  const published = await fileCatalogLemma(created, "search");
  const stored = dictionary.getWord(created.id) ?? created;
  return pack(query, [stored], true, published.inserted, spellingFixed, user, without(related, [stored]));
}
