export function targetWord(word: { word?: string | null; en: string }): string {
  const head = typeof word.word === "string" ? word.word.trim() : "";
  return head || word.en;
}

/** Latin headword plus its Cyrillic twin, when the studied language has one. */
export function studiedForms(word: { word?: string | null; en: string; wordCyrillic?: string | null }): string[] {
  const head = targetWord(word);
  const cyrillic = typeof word.wordCyrillic === "string" ? word.wordCyrillic.trim() : "";
  if (!cyrillic || cyrillic.toLocaleLowerCase("ru") === head.toLocaleLowerCase("ru")) return [head];
  return [head, cyrillic];
}

let code = "en";

export function setLanguageCode(next: string): void {
  code = (next || "en").toLowerCase();
}

export function languageCode(): string {
  return code;
}

export function directionLabel(direction: "en-ru" | "ru-en"): string {
  const mark = languageCode().toUpperCase();
  return direction === "en-ru" ? `${mark} → RU` : `RU → ${mark}`;
}

const ARTICLE_PREFIXES: Record<string, string[]> = {
  en: ["the ", "an ", "a "],
  fr: ["de la ", "de l'", "d'", "l'", "les ", "des ", "une ", "aux ", "du ", "le ", "la ", "un ", "au ", "de "],
  de: ["der ", "die ", "das ", "den ", "dem ", "ein ", "eine ", "einer ", "einem ", "einen "],
  es: ["los ", "las ", "el ", "la ", "unos ", "unas ", "un ", "una "],
};

export function stripArticle(value: string, language = languageCode()): string {
  let text = value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  const prefixes = [...(ARTICLE_PREFIXES[language] ?? ARTICLE_PREFIXES.en)].sort((a, b) => b.length - a.length);
  for (let guard = 0; guard < 3; guard += 1) {
    const next = prefixes.find((prefix) => text.startsWith(prefix) && text.length > prefix.length);
    if (!next) break;
    text = text.slice(next.length).trim();
  }
  return text;
}
