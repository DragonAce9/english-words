export const POS_LABEL: Record<string, string> = {
  n: "сущ.",
  v: "гл.",
  adj: "прил.",
  adv: "нареч.",
  numeral: "числ.",
  pronoun: "мест.",
  determiner: "опред.",
  preposition: "предл.",
  conjunction: "союз",
  interjection: "межд.",
};

export function posLabel(pos?: string | null): string | null {
  if (!pos) return null;
  return POS_LABEL[pos] ?? null;
}
