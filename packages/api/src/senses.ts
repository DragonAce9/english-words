import { activeLanguage } from "./catalogContext.js";
import { config } from "./config.js";
import { dictionary } from "./dictionary.js";
import type { DictWord, WordPos } from "./types.js";

export interface SenseHit {
  token: string;
  sentence: string;
  senses: DictWord[];
}

const VERB_CUES = new Set([
  "will",
  "would",
  "can",
  "could",
  "should",
  "must",
  "may",
  "might",
  "shall",
  "to",
  "please",
  "don't",
  "doesn't",
  "didn't",
  "lets",
]);
const SUBJECTS = new Set(["i", "you", "we", "they", "he", "she", "it"]);
const COPULA = new Set(["is", "are", "was", "were", "be", "been", "am", "seem", "seems", "feel", "feels", "look", "looks"]);
const DEGREE = new Set(["very", "really", "so", "too", "quite", "pretty", "rather"]);
const DETERMINERS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "its",
  "some",
  "any",
  "every",
  "each",
  "no",
  "own",
]);

let senseIndex: Map<string, DictWord[]> | null = null;
let senseKey = "";

function lemmaHead(en: string): string {
  return (en.split(/\s*\/\s*/)[0] ?? en)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Catalog ids store ü as u, ß as ss and đ as dj. */
function foldLatin(value: string): string {
  return value.replace(/ß/g, "ss").replace(/đ/g, "dj").normalize("NFD").replace(/\p{M}/gu, "");
}

function slugWord(en: string): string {
  return en.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "word";
}

function variants(token: string): string[] {
  const t = token.toLowerCase();
  const out = [t];
  if (t.endsWith("ies") && t.length > 4) out.push(`${t.slice(0, -3)}y`);
  if (t.endsWith("ing") && t.length > 5) {
    out.push(t.slice(0, -3), `${t.slice(0, -3)}e`, t.slice(0, -4));
  }
  if (t.endsWith("ed") && t.length > 4) out.push(t.slice(0, -2), t.slice(0, -1), `${t.slice(0, -2)}e`);
  if (t.endsWith("es") && t.length > 3) out.push(t.slice(0, -2), t.slice(0, -1));
  if (t.endsWith("s") && t.length > 3 && !t.endsWith("ss")) out.push(t.slice(0, -1));
  return [...new Set(out)];
}

function buildSenseIndex(): Map<string, DictWord[]> {
  const key = `${activeLanguage()}:${dictionary.revision}`;
  if (senseIndex && senseKey === key) return senseIndex;
  const index = new Map<string, DictWord[]>();
  const add = (keyName: string, word: DictWord) => {
    if (!keyName) return;
    const list = index.get(keyName) ?? [];
    if (!list.some((item) => item.id === word.id)) list.push(word);
    index.set(keyName, list);
  };
  for (const word of dictionary.words.values()) {
    const head = lemmaHead(word.en);
    const folded = foldLatin(head);
    const headSlug = slugWord(folded);
    const base = word.id.split("--")[0] ?? word.id;
    // Irregular-verb cards keep the whole paradigm in the id. Their lemma is indexed elsewhere.
    const lemmaCard = base === headSlug;
    const replacedHead = head !== "" && head !== headSlug;
    if (!lemmaCard && !replacedHead) continue;
    add(head, word);
    if (folded !== head) add(folded, word);
    add(headSlug, word);
    const compact = head.replace(/'/g, "");
    if (compact !== head) add(compact, word);
    const cyrillic = word.wordCyrillic?.toLowerCase().trim();
    if (cyrillic) add(cyrillic, word);
  }
  for (const list of index.values()) {
    list.sort((a, b) => Number(a.id.includes("--")) - Number(b.id.includes("--")) || a.id.localeCompare(b.id));
  }
  senseIndex = index;
  senseKey = key;
  return index;
}

/** Every catalog card that shares this lemma. One card when the word has a single meaning. */
export function catalogSenses(token: string): DictWord[] {
  const index = buildSenseIndex();
  for (const variant of variants(token)) {
    const direct = index.get(variant);
    if (direct && direct.length > 0) return direct;
    const slug = slugWord(variant);
    // Non-Latin phrases slug to the fallback id "word" and must not open that card.
    const letters = variant.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (slug === "word" && letters !== "word") continue;
    const bySlug = index.get(slug);
    if (bySlug && bySlug.length > 0) return bySlug;
  }
  return [];
}

export function splitSentences(source: string): string[] {
  return source
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function clipSentence(sentence: string): string {
  const trimmed = sentence.replace(/\s+/g, " ").trim();
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}…` : trimmed;
}

function mentions(sentence: string, token: string): boolean {
  const keys = new Set(variants(token));
  const words = sentence.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  return words.some((word) => variants(word).some((variant) => keys.has(variant)));
}

export function sentencesContaining(sentences: string[], token: string): string[] {
  return sentences.filter((sentence) => mentions(sentence, token));
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(items[Math.round((i * (items.length - 1)) / (max - 1))] as T);
  }
  return [...new Set(out)];
}

/** Up to a few lines where this lemma occurs, so each meaning in the source can be kept. */
export function senseOccurrences(source: string, token: string, senses: DictWord[], limit = 8): SenseHit[] {
  const found = sampleEvenly(sentencesContaining(splitSentences(source), token), limit).map(clipSentence);
  if (found.length === 0) return [{ token, sentence: "", senses }];
  return found.map((sentence) => ({ token, sentence, senses }));
}

function catalogThemeIds(wordId: string): string[] {
  return dictionary.themesFor(wordId).filter((themeId) => {
    const theme = dictionary.getTheme(themeId);
    return theme != null && !dictionary.isMediaPack(theme) && theme.kind !== "text";
  });
}

function posOf(word: DictWord): WordPos | undefined {
  const listed = dictionary.posFor(word.id);
  if (listed) return listed;
  const themes = catalogThemeIds(word.id);
  if (themes.length > 0 && themes.every((id) => id === "verbs" || id === "popular-verbs")) return "v";
  if (themes.length > 0 && themes.every((id) => id === "descriptions" || id.startsWith("descriptions-"))) return "adj";
  return undefined;
}

function inferredPos(sentence: string, lemma: string): WordPos | undefined {
  const words = sentence.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  const votes = new Map<WordPos, number>();
  const vote = (pos: WordPos, weight: number) => votes.set(pos, (votes.get(pos) ?? 0) + weight);
  for (let i = 0; i < words.length; i += 1) {
    const surface = words[i] ?? "";
    if (!mentions(surface, lemma)) continue;
    const prev = words[i - 1] ?? "";
    const next = words[i + 1] ?? "";
    if (VERB_CUES.has(prev)) vote("v", 4);
    if (SUBJECTS.has(prev)) vote("v", 3);
    if (COPULA.has(prev) || DEGREE.has(prev)) vote("adj", 4);
    if (DETERMINERS.has(prev)) vote("n", 3);
    if (
      DETERMINERS.has(prev) &&
      next &&
      !DETERMINERS.has(next) &&
      !COPULA.has(next) &&
      !VERB_CUES.has(next) &&
      !["and", "or", "but", "of", "in", "on", "at", "for", "with", "from", "by"].includes(next)
    ) {
      vote("adj", 3);
    }
    if (surface.endsWith("ly") && surface.length > lemma.length + 1) vote("adv", 4);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best) return undefined;
  if (second && best[1] < second[1] + 2) return undefined;
  return best[0];
}

const PARTICLE_NEXT = new Set([
  "to",
  "at",
  "in",
  "on",
  "into",
  "onto",
  "home",
  "again",
  "there",
  "here",
  "up",
  "down",
  "out",
  "off",
  "inside",
  "outside",
  "from",
  "the",
  "a",
  "an",
  "where",
  "when",
  "what",
  "why",
  "how",
  "if",
  "while",
  "because",
  "and",
  "or",
  "but",
  "right",
  "just",
  "now",
  "then",
]);

/** The sentence uses this spelling, but not as one of the catalog meanings. */
export function sentenceMissesSenses(sentence: string, token: string): boolean {
  const text = sentence.toLowerCase();
  const lemma = token.toLowerCase();
  if (lemma === "course" || variants(lemma).includes("course")) {
    const idiom = /\bof course\b/.test(text) || /(?:^|[-–—]\s*)course\b/.test(text.trim()) || /\bcourse\s+(?:i|you|we|they|he|she|it|not)\b/.test(text);
    const rest = text
      .replace(/\bof course\b/g, " ")
      .replace(/(?:^|[-–—]\s*)course\b/, " ")
      .replace(/\bcourse\s+(?:i|you|we|they|he|she|it|not)\b/g, " ");
    if (idiom && !/\bcourses?\b/.test(rest)) return true;
  }
  if (lemma === "order" || variants(lemma).includes("order")) {
    const rest = text.replace(/\bin order to\b/g, " ");
    if (/\bin order to\b/.test(text) && !/\borders?\b/.test(rest)) return true;
  }
  if (lemma === "mean" && /\b(so|too|very|really) mean\b/.test(text)) return true;
  if (
    (lemma === "land" || variants(lemma).includes("land")) &&
    /\b(hit land|land(?:ed|ing)? (?:a|an|the) (?:\w+ )?(?:deal|job|role|part|contract))\b/.test(text)
  ) {
    return true;
  }
  if ((lemma === "track" || variants(lemma).includes("track")) && /\b(keep(?:ing)? track|track(?:s|ed|ing)? (?:of|down))\b/.test(text)) {
    return true;
  }
  if (lemma === "back" || variants(lemma).includes("back")) {
    const words = text.match(/[a-z][a-z'-]*/g) ?? [];
    let saw = false;
    let lexical = false;
    for (let i = 0; i < words.length; i += 1) {
      if (words[i] !== "back") continue;
      saw = true;
      const prev = words[i - 1] ?? "";
      const next = words[i + 1] ?? "";
      if (DETERMINERS.has(prev)) lexical = true;
      if (next && !PARTICLE_NEXT.has(next)) lexical = true;
    }
    if (saw && !lexical) return true;
  }
  return false;
}

function primarySense(senses: DictWord[]): DictWord {
  return senses.find((sense) => !sense.id.includes("--")) ?? senses[0]!;
}

function themeOverlap(sentence: string, word: DictWord, self: Set<string>): number {
  const themes = new Set(catalogThemeIds(word.id));
  if (themes.size === 0) return 0;
  let score = 0;
  const words = sentence.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  const seen = new Set<string>();
  for (const token of words) {
    if (self.has(token) || seen.has(token)) continue;
    seen.add(token);
    const senses = catalogSenses(token);
    if (senses.length === 0) continue;
    const ids = new Set(senses.flatMap((sense) => catalogThemeIds(sense.id)));
    if ([...themes].some((themeId) => ids.has(themeId))) score += 2;
  }
  return score;
}

/** Pick a card from syntax and nearby theme words. `confident` means the sentence settles it. */
export function localPick(token: string, sentence: string, senses: DictWord[]): { word: DictWord; confident: boolean } {
  if (senses.length === 0) throw new Error("localPick requires a sense");
  if (senses.length === 1) return { word: senses[0]!, confident: true };
  if (!sentence.trim()) return { word: primarySense(senses), confident: true };

  const guessed = inferredPos(sentence, token);
  if (guessed) {
    const matching = senses.filter((sense) => posOf(sense) === guessed);
    if (matching.length === 1) return { word: matching[0]!, confident: true };
  }

  const self = new Set(variants(token));
  const ranked = senses
    .map((sense) => {
      const pos = posOf(sense);
      let score = sense.id.includes("--") ? 0 : 1;
      if (guessed && pos === guessed) score += 6;
      if (guessed && pos && pos !== guessed) score -= 4;
      score += themeOverlap(sentence, sense, self);
      return { sense, score };
    })
    .sort((a, b) => b.score - a.score || a.sense.id.localeCompare(b.sense.id));
  const best = ranked[0]!;
  const second = ranked[1];
  return { word: best.sense, confident: !second || best.score >= second.score + 4 };
}

export function pickClassifiedSense(
  word: { token?: string; en: string; ru: string[]; themeId?: string },
  sentence: string,
  senses: DictWord[],
): DictWord {
  if (senses.length === 1) return senses[0]!;
  const themed = word.themeId ? senses.filter((sense) => catalogThemeIds(sense.id).includes(word.themeId!)) : [];
  if (themed.length === 1) return themed[0]!;
  const pool = themed.length > 0 ? themed : senses;
  const glosses = new Set(word.ru.map((gloss) => gloss.toLowerCase().replaceAll("ё", "е")));
  const byGloss = pool.map((sense) => ({
    sense,
    overlap: sense.ru.filter((gloss) => glosses.has(gloss.toLowerCase().replaceAll("ё", "е"))).length,
  }));
  const bestOverlap = Math.max(...byGloss.map((item) => item.overlap));
  const winners = byGloss.filter((item) => item.overlap === bestOverlap && item.overlap > 0);
  if (winners.length === 1) return winners[0]!.sense;
  return localPick(word.token || word.en, sentence, pool).word;
}

type SenseAi = (hits: SenseHit[]) => Promise<(string | undefined)[]>;

const SENSE_SYSTEM =
  "You choose which dictionary sense an English word has in one sentence. " +
  "Return JSON {\"picks\":[{\"i\":0,\"id\":\"...\"}]} only. " +
  "Each item includes i, sentence, and senses with id, Russian glosses, and theme titles. " +
  "Pick exactly one id from that item's senses. Decide from the sentence. " +
  "If the sentence uses a meaning that is not in the list, return an empty id. " +
  "Do not choose the closest spelling. The same spelling can be a different meaning in another item.";

async function geminiSenseAi(hits: SenseHit[]): Promise<(string | undefined)[]> {
  const out: (string | undefined)[] = hits.map(() => undefined);
  if (!config.geminiApiKey || hits.length === 0) return out;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  for (let offset = 0; offset < hits.length; offset += 25) {
    const chunk = hits.slice(offset, offset + 25);
    const items = chunk.map((hit, index) => ({
      i: index,
      sentence: hit.sentence,
      senses: hit.senses.map((sense) => ({
        id: sense.id,
        ru: sense.ru.slice(0, 3),
        themes: catalogThemeIds(sense.id)
          .map((themeId) => dictionary.getTheme(themeId)?.title)
          .filter((title): title is string => Boolean(title)),
      })),
    }));
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SENSE_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ items }) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              picks: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    i: { type: "INTEGER" },
                    id: { type: "STRING" },
                  },
                  required: ["i", "id"],
                },
              },
            },
            required: ["picks"],
          },
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });
      if (response.ok || (response.status !== 429 && response.status !== 503)) break;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    if (!response?.ok) {
      const detail = await response?.text().catch(() => "") ?? "";
      throw new Error(`AI sense pick failed HTTP ${response?.status ?? 0} ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
    const parsed = JSON.parse(content) as { picks?: { i?: number; id?: string }[] };
    for (const pick of parsed.picks ?? []) {
      if (typeof pick.i !== "number" || pick.i < 0 || pick.i >= chunk.length) continue;
      if (!pick.id) {
        out[offset + pick.i] = "";
        continue;
      }
      if (!chunk[pick.i]?.senses.some((sense) => sense.id === pick.id)) continue;
      out[offset + pick.i] = pick.id;
    }
  }
  return out;
}

let senseAi: SenseAi = geminiSenseAi;

export function setSenseAi(fn: SenseAi | null): void {
  senseAi = fn ?? geminiSenseAi;
}

/**
 * Choose a card for each hit. Clear syntax is decided locally.
 * Unclear lines go to the model, except in tests, where the local guess is kept.
 */
/** One card per hit, in the same order. Missing when a hit has no senses. */
export async function resolveSenses(hits: SenseHit[]): Promise<(DictWord | undefined)[]> {
  const chosen: (DictWord | undefined)[] = hits.map((hit) => hit.senses[0]);
  const pending: number[] = [];
  hits.forEach((hit, index) => {
    if (hit.senses.length === 0 || sentenceMissesSenses(hit.sentence, hit.token)) {
      chosen[index] = undefined;
      return;
    }
    const local = localPick(hit.token, hit.sentence, hit.senses);
    chosen[index] = local.word;
    if (!local.confident && !process.env.VITEST) pending.push(index);
  });
  if (pending.length === 0) return chosen;
  try {
    const picked = await senseAi(pending.map((index) => hits[index]!));
    pending.forEach((index, order) => {
      const id = picked[order];
      if (id === "") {
        chosen[index] = undefined;
        return;
      }
      const sense = id ? hits[index]?.senses.find((item) => item.id === id) : undefined;
      if (sense) chosen[index] = sense;
    });
  } catch (error) {
    console.error("sense pick skipped", error);
  }
  return chosen;
}
