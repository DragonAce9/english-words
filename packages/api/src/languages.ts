import { config } from "./config.js";

export interface LanguageInfo {
  code: string;
  title: string;
  voice: string;
  dictionary: boolean;
  texts: boolean;
  mediaRequests: boolean;
}

const KNOWN: Record<string, Omit<LanguageInfo, "code">> = {
  en: {
    title: "Английский",
    voice: "en-US",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  fr: {
    title: "Французский",
    voice: "fr-FR",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  de: {
    title: "Немецкий",
    voice: "de-DE",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  es: {
    title: "Испанский",
    voice: "es-ES",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  it: {
    title: "Итальянский",
    voice: "it-IT",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  pt: {
    title: "Португальский",
    voice: "pt-BR",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  fi: {
    title: "Финский",
    voice: "fi-FI",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  sl: {
    title: "Словенский",
    voice: "sl-SI",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  hr: {
    title: "Хорватский",
    voice: "hr-HR",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
  sr: {
    title: "Сербский",
    voice: "sr-RS",
    dictionary: true,
    texts: true,
    mediaRequests: true,
  },
};

function parseCodes(raw: string | undefined): string[] {
  const codes = (raw ?? "en")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item in KNOWN);
  return codes.length > 0 ? [...new Set(codes)] : ["en"];
}

export function availableLanguages(): LanguageInfo[] {
  void config;
  return parseCodes(process.env.AVAILABLE_LANGUAGES).map((code) => ({ code, ...KNOWN[code] }));
}

export function isAvailableLanguage(code: unknown): code is string {
  return typeof code === "string" && availableLanguages().some((item) => item.code === code);
}

export function languageInfo(code: string): LanguageInfo | undefined {
  const known = KNOWN[code];
  if (!known) return undefined;
  return { code, ...known };
}

/** Same order as the /start welcome. Not limited to languages a learner can study today. */
const NAMED_LANGUAGE_CODES = ["en", "fr", "de", "es", "it", "pt", "fi", "sl", "hr", "sr"] as const;

export function namedLanguages(): LanguageInfo[] {
  return NAMED_LANGUAGE_CODES.map((code) => ({ code, ...KNOWN[code] }));
}

/** Picker stays `languages`. Caps follow the user's language even when it is not listed yet. */
export function languageState(user: { language: string; languageChosen: boolean }) {
  return {
    language: user.language,
    languageChosen: user.languageChosen,
    languages: availableLanguages(),
    activeLanguage: languageInfo(user.language) ?? languageInfo("en")!,
  };
}

/** Studied-language headword. English cards keep word === en. */
export function targetHead(word: { word?: string | null; en: string }): string {
  const head = typeof word.word === "string" ? word.word.trim() : "";
  return head || word.en;
}

const ARTICLE_PREFIXES: Record<string, string[]> = {
  en: ["the ", "an ", "a "],
  fr: ["de la ", "de l'", "d'", "l'", "les ", "des ", "une ", "aux ", "du ", "le ", "la ", "un ", "au ", "de "],
  de: ["der ", "die ", "das ", "den ", "dem ", "ein ", "eine ", "einer ", "einem ", "einen "],
  es: ["los ", "las ", "el ", "la ", "unos ", "unas ", "un ", "una "],
  it: [
    "dello ",
    "della ",
    "dell'",
    "degli ",
    "delle ",
    "allo ",
    "alla ",
    "all'",
    "agli ",
    "alle ",
    "uno ",
    "una ",
    "gli ",
    "del ",
    "dei ",
    "al ",
    "ai ",
    "il ",
    "lo ",
    "la ",
    "l'",
    "le ",
    "i ",
    "un ",
  ],
  pt: ["umas ", "uns ", "uma ", "dos ", "das ", "nos ", "nas ", "aos ", "às ", "um ", "os ", "as ", "do ", "da ", "no ", "na ", "ao ", "à ", "o ", "a "],
  fi: [],
  sl: [],
  hr: [],
  sr: [],
};

/** Drop a leading article so «le banque» and «la banque» match «banque». */
export function stripArticle(value: string, language: string): string {
  let text = value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  const prefixes = [...(ARTICLE_PREFIXES[language] ?? ARTICLE_PREFIXES.en)].sort((a, b) => b.length - a.length);
  for (let guard = 0; guard < 3; guard += 1) {
    const next = prefixes.find((prefix) => text.startsWith(prefix) && text.length > prefix.length);
    if (!next) break;
    text = text.slice(next.length).trim();
  }
  return text;
}
