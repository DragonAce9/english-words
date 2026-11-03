#!/usr/bin/env npx tsx
/**
 * One-off catalog review. Not used by the app.
 *
 * Reviews every catalog card (headword + current translation + current theme).
 * A word may sit in several themes; only a card that does not belong is a
 * category error. Synonyms are not translation errors. Failures are written
 * back into data/themes: a bad translation is replaced, a word in the wrong
 * theme is removed or moved.
 *
 *   npx tsx scripts/audit-word-sample.ts
 */
import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const BATCH = 40;
const CHECKPOINT = join(root, "scripts/.audit-catalog-reviews.json");

interface ThemeWord {
  id: string;
  en: string;
  ru: string[];
  example?: string;
  level?: string;
}

interface ThemeFile {
  id: string;
  title: string;
  words: ThemeWord[];
}

interface LoadedTheme {
  path: string;
  theme: ThemeFile;
  dirty: boolean;
}

interface Card {
  id: string;
  wordId: string;
  en: string;
  head: string;
  ru: string[];
  example: string;
  themeId: string;
  themeTitle: string;
}

interface Review {
  id: string;
  translationOk: boolean;
  categoryOk: boolean;
  reason: string;
  ru: string[];
  moveTo: string;
}

const REVIEW_SYSTEM = [
  "Ты проверяешь карточки англо-русского словаря.",
  "Для каждой карточки два независимых ответа: верен ли перевод этому значению слова и уместно ли слово в этой теме.",
  "Слово может честно входить в несколько тем. Тему отмечай неверной только если это значение к ней не относится.",
  "Не отмечай тему ошибкой только потому, что подошла бы и другая.",
  "Перевод неверен, если он про другое значение или явно кривой.",
  "Синоним и другая часть речи того же значения (блевать/рвота, алый/малиновый) — не ошибка.",
  "Если оба ответа да, reason оставь пустым, ru — пустой массив, moveTo — пустая строка.",
  "Если перевод неверен для того значения, которое должно остаться в карточке, translationOk = false и ru — до трёх верных русских переводов.",
  "Синоним не заменяй. Если тема неверна, а текущий перевод описывает другое верное значение, translationOk оставь true и укажи moveTo — id темы этого значения.",
  "moveTo — id из списка тем или пустая строка, если слово нужно только убрать из этой темы. Не выдумывай id.",
  "Если что-то нет, reason — одна короткая фраза по-русски. Верни каждую карточку с тем же id.",
].join(" ");

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    reviews: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          translationOk: { type: "BOOLEAN" },
          categoryOk: { type: "BOOLEAN" },
          reason: { type: "STRING" },
          ru: { type: "ARRAY", items: { type: "STRING" } },
          moveTo: { type: "STRING" },
        },
        required: ["id", "translationOk", "categoryOk", "reason", "ru", "moveTo"],
      },
    },
  },
  required: ["reviews"],
};

function loadEnv(name: string, fallback = ""): string {
  if (process.env[name]) return process.env[name] ?? fallback;
  const path = join(root, ".env");
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || trimmed.slice(0, eq) !== name) continue;
    return trimmed.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return fallback;
}

function headword(en: string): string {
  const first = en.split(/\s*\/\s*/)[0] ?? en;
  return first.replace(/\s+/g, " ").trim();
}

function csv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!fenced) return {};
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return {};
    }
  }
}

function parseReviews(payload: unknown): Review[] {
  const rootPayload = payload as { reviews?: unknown[] };
  const items = Array.isArray(rootPayload?.reviews) ? rootPayload.reviews : [];
  const out: Review[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const ruRaw = Array.isArray(row.ru) ? row.ru : [];
    out.push({
      id,
      translationOk: row.translationOk === true,
      categoryOk: row.categoryOk === true,
      reason: String(row.reason ?? "").trim(),
      ru: ruRaw.map((value) => String(value ?? "").trim()).filter(Boolean),
      moveTo: String(row.moveTo ?? "").trim(),
    });
  }
  return out;
}

function russianGlosses(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!/[а-яё]/i.test(text) || out.includes(text)) continue;
    out.push(text);
    if (out.length === 3) break;
  }
  return out;
}

function insertWord(theme: ThemeFile, word: ThemeWord): void {
  if (theme.words.some((item) => item.id === word.id)) return;
  theme.words.push(word);
  theme.words.sort((a, b) => a.en.localeCompare(b.en) || a.id.localeCompare(b.id));
}

function applyFixes(
  cards: Card[],
  reviews: Map<string, Review>,
  loaded: Map<string, LoadedTheme>,
): string[] {
  const themeIds = new Set(loaded.keys());
  const byWord = new Map<string, { card: Card; review: Review }[]>();
  for (const card of cards) {
    const review = reviews.get(card.id);
    if (!review || (review.translationOk && review.categoryOk)) continue;
    const list = byWord.get(card.wordId) ?? [];
    list.push({ card, review });
    byWord.set(card.wordId, list);
  }

  const actions: string[] = [];
  for (const [wordId, ops] of byWord) {
    const homes = new Set((cards.filter((card) => card.wordId === wordId)).map((card) => card.themeId));
    const removals = ops.filter((op) => !op.review.categoryOk);
    const destinations = new Set<string>();
    for (const op of removals) {
      const moveTo = op.review.moveTo;
      if (moveTo && moveTo !== op.card.themeId && themeIds.has(moveTo)) destinations.add(moveTo);
    }
    const finalHomes = new Set(homes);
    for (const op of removals) finalHomes.delete(op.card.themeId);
    for (const themeId of destinations) finalHomes.add(themeId);
    const keepRemovals = finalHomes.size > 0;

    for (const op of ops) {
      const source = loaded.get(op.card.themeId);
      const word = source?.theme.words.find((item) => item.id === wordId);
      if (!source || !word) continue;
      const glosses = russianGlosses(op.review.ru);
      const leave = !op.review.categoryOk && keepRemovals;

      if (!op.review.translationOk && op.review.categoryOk && glosses.length > 0 && !leave) {
        word.ru = glosses;
        source.dirty = true;
        actions.push(`${op.card.head}: перевод в «${op.card.themeTitle}» → ${glosses.join(", ")}`);
      }

      if (!leave) {
        if (!op.review.categoryOk && !keepRemovals) {
          actions.push(`${op.card.head}: «${op.card.themeTitle}» не убрал, другое место не указано`);
        }
        continue;
      }

      source.theme.words = source.theme.words.filter((item) => item.id !== wordId);
      source.dirty = true;
      const moveTo = op.review.moveTo;
      const destId = moveTo && moveTo !== op.card.themeId && themeIds.has(moveTo) ? moveTo : "";
      if (!destId) {
        actions.push(`${op.card.head}: убрал из «${op.card.themeTitle}»`);
        continue;
      }
      const dest = loaded.get(destId);
      if (!dest) continue;
      const nextRu = !op.review.translationOk && glosses.length > 0 ? glosses : word.ru;
      const existing = dest.theme.words.find((item) => item.id === wordId);
      if (existing) {
        if (!op.review.translationOk && glosses.length > 0) {
          existing.ru = glosses;
          dest.dirty = true;
        }
      } else {
        insertWord(dest.theme, { ...word, ru: [...nextRu] });
        dest.dirty = true;
      }
      actions.push(`${op.card.head}: «${op.card.themeTitle}» → «${dest.theme.title}»${nextRu === word.ru ? "" : ` (${nextRu.join(", ")})`}`);
    }
  }
  return actions;
}

async function reviewBatch(
  cards: Card[],
  themeList: { id: string; title: string }[],
  apiKey: string,
  model: string,
): Promise<Review[]> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const payload = cards.map((card) => ({
    id: card.id,
    en: card.head,
    ru: card.ru,
    themeId: card.themeId,
    theme: card.themeTitle,
    ...(card.example ? { example: card.example } : {}),
  }));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: REVIEW_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ themes: themeList, cards: payload }) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: REVIEW_SCHEMA,
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI review failed HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
  return parseReviews(parseModelJson(content));
}

async function main() {
  const apiKey = loadEnv("GEMINI_API_KEY");
  const model = loadEnv("GEMINI_MODEL", "gemini-3.1-flash-lite");
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const themesDir = join(root, "data/en/themes");
  const files = (await readdir(themesDir)).filter((name) => name.endsWith(".json")).sort();
  const loaded = new Map<string, LoadedTheme>();
  for (const file of files) {
    const theme = JSON.parse(await readFile(join(themesDir, file), "utf8")) as ThemeFile;
    loaded.set(theme.id, { path: join(themesDir, file), theme, dirty: false });
  }
  const themeList = [...loaded.values()].map((item) => ({ id: item.theme.id, title: item.theme.title }));

  const listings = new Map<string, Card[]>();
  for (const item of loaded.values()) {
    const theme = item.theme;
    for (const word of theme.words) {
      const card: Card = {
        id: `${word.id}@${theme.id}`,
        wordId: word.id,
        en: word.en,
        head: headword(word.en),
        ru: word.ru,
        example: word.example?.trim() ?? "",
        themeId: theme.id,
        themeTitle: theme.title,
      };
      const list = listings.get(word.id) ?? [];
      list.push(card);
      listings.set(word.id, list);
    }
  }

  const cards = [...listings.values()].flat();
  const reviews = new Map<string, Review>();
  try {
    const saved = JSON.parse(await readFile(CHECKPOINT, "utf8")) as { reviews?: Review[] };
    for (const review of saved.reviews ?? []) reviews.set(review.id, review);
  } catch {
    // First run has no checkpoint.
  }

  const pending = cards.filter((card) => !reviews.has(card.id));
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    let got: Review[] = [];
    let attempt = 0;
    while (true) {
      try {
        got = await reviewBatch(batch, themeList, apiKey, model);
        break;
      } catch (error) {
        attempt += 1;
        if (attempt >= 4) throw error;
        console.error(`batch retry ${attempt}: ${error instanceof Error ? error.message : error}`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
    for (const review of got) reviews.set(review.id, review);
    await writeFile(CHECKPOINT, JSON.stringify({ reviews: [...reviews.values()] }));
    console.log(`progress ${reviews.size}/${cards.length}`);
  }

  const actions = applyFixes(cards, reviews, loaded);
  const written: string[] = [];
  for (const item of loaded.values()) {
    if (!item.dirty) continue;
    await writeFile(item.path, `${JSON.stringify(item.theme, null, 2)}\n`, "utf8");
    written.push(item.theme.id);
  }

  const problems: string[][] = [];
  let translationNo = 0;
  let categoryNo = 0;
  let unanswered = 0;
  for (const card of cards) {
    const review = reviews.get(card.id);
    if (!review) {
      unanswered += 1;
      problems.push([card.head, card.themeTitle, card.ru.join("; "), "нет ответа", "нет ответа", "модель не вернула карточку", ""]);
      continue;
    }
    if (review.translationOk && review.categoryOk) continue;
    if (!review.translationOk) translationNo += 1;
    if (!review.categoryOk) categoryNo += 1;
    problems.push([
      card.head,
      card.themeTitle,
      card.ru.join("; "),
      review.translationOk ? "да" : "нет",
      review.categoryOk ? "да" : "нет",
      review.reason,
      actions.find((action) => action.startsWith(`${card.head}:`)) ?? "",
    ]);
  }

  const header = ["Слово", "Тема", "Перевод в базе", "Перевод верен", "Тема верна", "Причина", "Исправление"];
  const body = [header, ...problems].map((row) => row.map(csv).join(",")).join("\n");
  const out = join(process.env.HOME ?? root, "Desktop", "проверка-каталога.csv");
  await writeFile(out, `\uFEFF${body}`, "utf8");

  console.log(
    JSON.stringify(
      {
        words: listings.size,
        cards: cards.length,
        translationNo,
        categoryNo,
        unanswered,
        problems: problems.length,
        fixes: actions.length,
        files: written,
        report: out,
      },
      null,
      2,
    ),
  );
  for (const action of actions) console.log(action);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
