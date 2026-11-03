import { config } from "./config.js";
import { dictionary } from "./dictionary.js";
import { slugWord } from "./userWords.js";

export interface ClassifiedWord {
  token: string;
  en: string;
  ru: string[];
  themeId: string;
  pos?: string;
}

export type ClassifyFn = (tokens: string[]) => Promise<ClassifiedWord[]>;

const SKIP_THEME_IDS = new Set(["irregular-verbs", "popular-verbs"]);

function themeCatalog(): { id: string; title: string }[] {
  return dictionary
    .listThemes()
    .filter((theme) => theme.blockId !== "media" && !SKIP_THEME_IDS.has(theme.id))
    .map((theme) => ({ id: theme.id, title: theme.title }));
}

function normalizeThemeId(raw: unknown): string {
  const id = String(raw ?? "").trim();
  if (id === "irregular-verbs" || id === "popular-verbs") return "verbs";
  const theme = dictionary.getTheme(id);
  if (theme && theme.blockId !== "media" && !SKIP_THEME_IDS.has(id)) return id;
  return "general";
}

function parseClassified(payload: unknown): ClassifiedWord[] {
  const root = payload as { words?: unknown[] };
  const items = Array.isArray(root?.words) ? root.words : Array.isArray(payload) ? payload : [];
  const out: ClassifiedWord[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const en = String(row.en ?? row.lemma ?? "").trim().toLowerCase();
    if (!en || !/[a-z]/i.test(en)) continue;
    const ruRaw = Array.isArray(row.ru) ? row.ru : [row.ru];
    const ru = ruRaw.map((value) => String(value ?? "").trim()).filter(Boolean);
    const pos = String(row.pos ?? "").trim().toLowerCase() || undefined;
    out.push({
      token: String(row.token ?? "").trim().toLowerCase(),
      en,
      ru: ru.length > 0 ? ru : [en],
      themeId: normalizeThemeId(row.themeId ?? row.theme),
      pos,
    });
  }
  return out;
}

const LEMMA_SYSTEM =
  "You lemmatize English tokens for a vocabulary app. Return JSON {\"words\":[...]} only. " +
  "Each item: {\"token\": original, \"en\": dictionary headword, \"pos\": noun|verb|adj|adv|other, \"ru\": [Russian glosses], \"themeId\": id from the list}. " +
  "Verbs → infinitive without \"to\". Nouns → singular. Adjectives/adverbs → base form. " +
  "If one token is several parts of speech, return several items with the same token. " +
  "Do not invent CEFR levels or example sentences. Skip names, numbers, and noise. themeId must be from the list.";

const WORD_SCHEMA = {
  type: "OBJECT",
  properties: {
    words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          token: { type: "STRING" },
          en: { type: "STRING" },
          pos: { type: "STRING" },
          ru: { type: "ARRAY", items: { type: "STRING" } },
          themeId: { type: "STRING" },
        },
        required: ["token", "en", "ru", "themeId"],
      },
    },
  },
  required: ["words"],
};

export async function geminiGenerateJson(input: {
  system: string;
  user: string;
  schema?: unknown;
}): Promise<unknown> {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: [{ text: input.user }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        ...(input.schema ? { responseSchema: input.schema } : {}),
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`Gemini HTTP ${response.status} ${detail.slice(0, 300)}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
  return parseModelJson(content);
}

function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return {};
      }
    }
    return {};
  }
}

async function defaultClassify(tokens: string[]): Promise<ClassifiedWord[]> {
  if (tokens.length === 0) return [];
  if (!config.geminiApiKey) return [];

  const themes = themeCatalog();
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += 60) chunks.push(tokens.slice(i, i + 60));

  const classified: ClassifiedWord[] = [];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  for (const chunk of chunks) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: LEMMA_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify({ themes, tokens: chunk }) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: WORD_SCHEMA,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI classify failed HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
    classified.push(...parseClassified(parseModelJson(content)));
  }
  return classified;
}

export let classifyUnknown: ClassifyFn = defaultClassify;

export function setClassifyUnknown(fn: ClassifyFn | null): void {
  classifyUnknown = fn ?? defaultClassify;
}

export function classifiedToId(word: ClassifiedWord): string {
  return slugWord(word.en);
}

export interface DefinedWord {
  en: string;
  ru: string[];
  themeId: string;
  pos?: string;
  example: string;
  level: string;
}

export type DefineFn = (query: string) => Promise<DefinedWord | null>;

const DEFINE_SYSTEM =
  "You are a concise English-Russian dictionary for a vocabulary app. Return JSON only. " +
  "The query may be English or Russian, a word or a short phrase. " +
  "If it is not a real dictionary item (gibberish, a full sentence, a personal name), return {\"found\": false}. " +
  "If the query is misspelled, set en to the corrected lemma and never to the typo. If the intended word is unclear, return {\"found\": false}. " +
  "Otherwise return one most common meaning: " +
  "{\"found\": true, \"en\": lemma, \"ru\": [up to 3 Russian glosses], \"pos\": noun|verb|adj|adv|other, \"themeId\": id from the list, \"example\": one short English sentence, \"level\": A1|A2|B1|B2|C1|C2}. " +
  "Verbs → infinitive without \"to\". Nouns → singular. If the query is Russian, \"en\" is the English lemma. themeId must be from the list.";

const DEFINE_SCHEMA = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN" },
    en: { type: "STRING" },
    ru: { type: "ARRAY", items: { type: "STRING" } },
    pos: { type: "STRING" },
    themeId: { type: "STRING" },
    example: { type: "STRING" },
    level: { type: "STRING" },
  },
  required: ["found"],
};

function parseDefined(payload: unknown): DefinedWord | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (row.found === false) return null;
  const en = String(row.en ?? "").trim().toLowerCase();
  if (!en || !/[a-z]/i.test(en)) return null;
  const ruRaw = Array.isArray(row.ru) ? row.ru : [row.ru];
  const ru = ruRaw.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 3);
  if (ru.length === 0) return null;
  return {
    en,
    ru,
    themeId: normalizeThemeId(row.themeId ?? row.theme),
    pos: String(row.pos ?? "").trim().toLowerCase() || undefined,
    example: String(row.example ?? "").trim().slice(0, 180),
    level: String(row.level ?? "").trim().toUpperCase(),
  };
}

async function defaultDefine(query: string): Promise<DefinedWord | null> {
  if (!query.trim() || !config.geminiApiKey || process.env.VITEST) return null;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: DEFINE_SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify({ themes: themeCatalog(), query }) }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: DEFINE_SCHEMA,
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI define failed HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
  return parseDefined(parseModelJson(content));
}

export let defineDictionaryWord: DefineFn = defaultDefine;

export function setDefineDictionaryWord(fn: DefineFn | null): void {
  defineDictionaryWord = fn ?? defaultDefine;
}
