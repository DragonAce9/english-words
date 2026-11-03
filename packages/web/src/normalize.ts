export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function compact(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, "");
}

/** All strings that count as a correct typed answer for a card. */
export function acceptedAnswers(expected: string[]): string[] {
  const out = new Set<string>();
  for (const raw of expected) {
    const full = normalizeAnswer(raw);
    if (!full) continue;
    out.add(full);
    const withoutParens = normalizeAnswer(full.replace(/\([^)]*\)/g, " "));
    if (withoutParens) out.add(withoutParens);
    for (const part of full.split(/\s*(?:[/|,;]| и )\s*/)) {
      const piece = normalizeAnswer(part.replace(/\([^)]*\)/g, " "));
      if (piece && piece.length >= 2) out.add(piece);
    }
  }
  return [...out];
}

export function answersMatch(input: string, expected: string[]): boolean {
  const got = normalizeAnswer(input);
  if (!got) return false;
  const variants = acceptedAnswers(expected);
  if (variants.includes(got)) return true;
  const gotCompact = compact(got);
  return gotCompact.length >= 2 && variants.some((item) => compact(item) === gotCompact);
}
