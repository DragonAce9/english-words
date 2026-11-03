import { splitSentences } from "./senses.js";

/** Same cap as a stored subtitle example: one line, not a quote or a cue file. */
const SHORT_LINE = 140;

function clip(line: string): string {
  const trimmed = line.replace(/\s+/g, " ").trim();
  return trimmed.length > SHORT_LINE ? `${trimmed.slice(0, SHORT_LINE - 3)}…` : trimmed;
}

/**
 * One short subtitle sentence for a learn card.
 * Prefers a sentence that names the lemma. An empty example stays empty.
 * A single stored line that is already short is kept as-is.
 * A long cue is reduced to one sentence instead of the whole file.
 */
export function shortSubtitleLine(example: string, lemma: string): string {
  const raw = example.replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const chunks = splitSentences(raw);
  const parts = chunks.length > 0 ? chunks : [raw];
  const short = parts.filter((part) => part.length <= SHORT_LINE);
  if (short.length === 0) return clip(parts[0] ?? raw);
  const needle = lemma.trim().toLowerCase();
  if (needle) {
    const hit = short.find((part) => part.toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return short[0] ?? raw;
}
