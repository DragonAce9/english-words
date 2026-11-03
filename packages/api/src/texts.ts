import { classifyUnknown, classifiedToId, type ClassifiedWord } from "./ai.js";
import { invalidateThemeCatalog } from "./catalogCache.js";
import { lookupWiktionary, slugHead, WIKTIONARY_SOURCE, type WikiEntry } from "./wiktionary.js";
import { activeLanguage } from "./catalogContext.js";
import { fileCatalogLemma } from "./catalog.js";
import { catalogSenses, clipSentence, pickClassifiedSense, resolveSenses, splitSentences, type SenseHit } from "./senses.js";
import { formatRuDate, recordTextUpload, textQuota, themeLocked } from "./access.js";
import { dictionary } from "./dictionary.js";
import { sql } from "./db.js";
import { HttpError } from "./httpError.js";
import type { AppUser, DictTheme, DictWord } from "./types.js";
import { extrasByTheme, loadUserWordRows, slugWord, type UserWordRow } from "./userWords.js";

export const TEXT_THEME_PREFIX = "text:";

export function textThemeId(textId: string): string {
  return `${TEXT_THEME_PREFIX}${textId}`;
}

export function parseTextThemeId(themeId: string): string | null {
  if (!themeId.startsWith(TEXT_THEME_PREFIX)) return null;
  const id = themeId.slice(TEXT_THEME_PREFIX.length);
  return /^\d+$/.test(id) ? id : null;
}

const STOPWORDS = new Set(
  `a an the and or but if then than as at by for from in into of on to with without about above after again all also am is are was were be been being can could would should will just not no nor so such too very more most other some any every each few many much own same both once only over under again further here there when where why how all what which who whom this that these those i me my we our you your he she it they them his her its their do does did done have has had having get got go going went gone make made take took come came see saw know knew think thought want need like look use used using say said tell told`.split(
    /\s+/,
  ),
);

const STOPWORDS_BY_LANGUAGE: Record<string, Set<string>> = {
  de: new Set("der die das den dem des ein eine einer einem einen und oder aber nicht ist sind war waren mit von zu auf für im am in an".split(" ")),
  fr: new Set("le la les un une des du de et ou mais ne pas est sont était avec pour dans sur au aux en".split(" ")),
  es: new Set("el la los las un una unos unas y o pero no es son era con de por para en al del".split(" ")),
  it: new Set("il lo la i gli le un uno una e o ma non è sono con di da per in del nel".split(" ")),
  pt: new Set("o a os as um uma uns umas e ou mas não é são com de do da em no na por para".split(" ")),
  fi: new Set("ja tai on ei ole että kun mutta myös se".split(" ")),
  sl: new Set("in je ali ne da se na za z s k".split(" ")),
  hr: new Set("i je ili ne da se na za u s k".split(" ")),
  sr: new Set("i je ili ne da se na za u s k".split(" ")),
};

export interface TextInput {
  title?: string;
  body: string;
}

export interface SavedText {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface ThemeRecommendation {
  themeId: string;
  title: string;
  locked: boolean;
  inText: number;
  known: number;
  unknown: number;
  added: number;
  sample: string[];
}

export interface TextAnalysis {
  uniqueWords: number;
  matched: number;
  added: number;
  skipped: number;
  usedAi: boolean;
  textIds: string[];
  recommendations: ThemeRecommendation[];
  addedWords: { id: string; en: string; ru: string[]; themeId: string; themeTitle: string }[];
}

function lemmaHead(en: string): string {
  return (en.split(/\s*\/\s*/)[0] ?? en)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export function extractTokens(text: string, language = activeLanguage()): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  if (language === "en") {
    for (const raw of text.match(/[A-Za-z][A-Za-z'-]{1,}/g) ?? []) {
      const token = raw.toLowerCase().replace(/^'+|'+$/g, "");
      if (token.length < 2 || STOPWORDS.has(token) || seen.has(token)) continue;
      seen.add(token);
      found.push(token);
    }
    return found;
  }
  const stops = STOPWORDS_BY_LANGUAGE[language] ?? new Set<string>();
  for (const raw of text.match(/[\p{L}][\p{L}'’-]+/gu) ?? []) {
    const token = raw.toLowerCase().replace(/^['’]+|['’]+$/g, "");
    if (token.length < 2 || stops.has(token) || seen.has(token)) continue;
    seen.add(token);
    found.push(token);
  }
  return found;
}

export function matchCatalog(token: string): DictWord | undefined {
  const senses = catalogSenses(token);
  return senses.find((sense) => !sense.id.includes("--")) ?? senses[0];
}

export function exampleFromSource(source: string, token: string): string {
  if (!token) return "";
  const needle = token.toLowerCase();
  for (const part of source.split(/(?<=[.!?])\s+|\n+/)) {
    if (!part.toLowerCase().includes(needle)) continue;
    const trimmed = part.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    return trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
  }
  return "";
}

export function dictWordFromLemma(
  word: ClassifiedWord,
  source: string,
  extraIndex?: Map<string, DictWord>,
): { existing?: DictWord; created?: DictWord } {
  const senses = catalogSenses(word.en);
  const sentence = exampleFromSource(source, word.token || word.en);
  if (senses.length > 1) return { existing: pickClassifiedSense(word, sentence, senses) };
  const existing =
    senses[0] ??
    dictionary.getWord(classifiedToId(word)) ??
    (extraIndex ? extraIndex.get(classifiedToId(word)) ?? matchExtra(word.en, extraIndex) : undefined);
  if (existing) return { existing };
  return {
    created: {
      id: classifiedToId(word),
      en: word.en,
      ru: word.ru.slice(0, 3),
      example: exampleFromSource(source, word.token || word.en),
      level: "B1",
    },
  };
}

function wordFromWiktionary(
  entry: WikiEntry,
  token: string,
  source: string,
): { existing?: DictWord; created?: DictWord } {
  const sentence = exampleFromSource(source, token);
  const senses = catalogSenses(entry.word);
  if (senses.length > 1) {
    return {
      existing: pickClassifiedSense(
        { token, en: entry.word, ru: entry.ru, themeId: "general" },
        sentence,
        senses,
      ),
    };
  }
  const id = slugHead(entry.word);
  const existing = senses[0] ?? dictionary.getWord(id);
  if (existing) return { existing };
  return {
    created: {
      id,
      en: entry.word,
      word: entry.word,
      ru: entry.ru.slice(0, 3),
      example: sentence || entry.example,
      level: "B1",
      pos: entry.pos,
      gender: entry.gender,
      source: WIKTIONARY_SOURCE,
    },
  };
}

function titleFrom(body: string, fallback: string): string {
  const line = body.trim().split(/\n+/)[0]?.trim() ?? "";
  if (!line) return fallback;
  return line.length > 48 ? `${line.slice(0, 45)}…` : line;
}

async function knownIds(userId: string): Promise<Set<string>> {
  const rows = await sql<{ word_id: string }[]>`
    SELECT word_id FROM word_progress
    WHERE user_id = ${userId}::bigint AND language = ${activeLanguage()} AND status = 'known'
  `;
  return new Set(rows.map((row) => dictionary.resolveWordId(row.word_id)));
}

export async function listUserTexts(user: AppUser) {
  const texts = await sql<{ id: string; title: string; body: string; created_at: Date }[]>`
    SELECT id, title, body, created_at
    FROM user_texts
    WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()} AND btrim(body) <> ''
    ORDER BY created_at DESC
    LIMIT 30
  `;
  const run = await sql<{ result: TextAnalysis | string }[]>`
    SELECT result FROM user_text_runs WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()}
  `;
  const mapped = texts.map((row) => ({
    id: String(row.id),
    title: row.title,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  }));
  const liveIds = new Set(mapped.map((item) => item.id));
  const analysis = liveAnalysis(parseAnalysis(run[0]?.result), liveIds);
  return {
    texts: mapped,
    analysis,
    quota: await textQuota(user, mapped.length),
  };
}

function parseAnalysis(raw: TextAnalysis | string | null | undefined): TextAnalysis | null {
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as TextAnalysis) : raw;
}

function liveAnalysis(analysis: TextAnalysis | null, liveIds: Set<string>): TextAnalysis | null {
  if (!analysis) return null;
  const textIds = (analysis.textIds ?? []).filter((id) => liveIds.has(id));
  if (textIds.length === (analysis.textIds ?? []).length) return analysis;
  return { ...analysis, textIds };
}

function textPackTitle(title: string, body: string): string {
  const stored = title.trim();
  if (!stored) return "Текст";
  return /^текст\s+\d+$/i.test(stored) ? titleFrom(body, stored) : stored;
}

/** Drop the written document. An enrolled pack keeps title and word ids on the same row. */
async function retainEnrolledText(user: AppUser, textId: string): Promise<void> {
  const rows = await sql<{ id: string; title: string; body: string; word_ids: unknown }[]>`
    SELECT id, title, body, word_ids
    FROM user_texts
    WHERE id = ${textId}::bigint AND user_id = ${user.id}::bigint AND language = ${activeLanguage()}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return;
  let ids = storedWordIds(row.word_ids);
  if (!ids) {
    const extraIndex = extraByLemma(await loadUserWordRows(user.id));
    ids = (await wordsInBody(row.body, extraIndex)).map((word) => word.id);
  }
  await sql`
    UPDATE user_texts
    SET title = ${textPackTitle(row.title, row.body)}, body = '', word_ids = ${sql.json(ids)}
    WHERE id = ${row.id}::bigint AND user_id = ${user.id}::bigint
  `;
}

export async function deleteUserText(user: AppUser, textId: string): Promise<void> {
  const language = user.language || activeLanguage();
  const themeId = textThemeId(textId);
  const enrolled = await sql<{ theme_id: string }[]>`
    SELECT theme_id
    FROM user_studying
    WHERE user_id = ${user.id}::bigint AND language = ${language} AND theme_id = ${themeId}
    LIMIT 1
  `;
  if (enrolled.length > 0) {
    await retainEnrolledText(user, textId);
  } else {
    await sql`
      DELETE FROM user_studying
      WHERE user_id = ${user.id}::bigint AND language = ${language} AND theme_id = ${themeId}
    `;
    await sql`
      DELETE FROM user_texts
      WHERE id = ${textId}::bigint AND user_id = ${user.id}::bigint AND language = ${activeLanguage()}
    `;
  }
  invalidateThemeCatalog(user.id);
  const run = await sql<{ result: TextAnalysis | string }[]>`
    SELECT result FROM user_text_runs WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()}
  `;
  const analysis = parseAnalysis(run[0]?.result);
  if (!analysis?.textIds?.includes(textId)) return;
  const next = { ...analysis, textIds: analysis.textIds.filter((id) => id !== textId) };
  await sql`
    UPDATE user_text_runs
    SET result = ${sql.json(next as never)}, updated_at = now()
    WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()}
  `;
}

function indexUserWord(index: Map<string, DictWord>, word: DictWord): void {
  index.set(word.id, word);
  const head = lemmaHead(word.en);
  if (head && !index.has(head)) index.set(head, word);
  const compact = head.replace(/'/g, "");
  if (compact && !index.has(compact)) index.set(compact, word);
  const slug = slugWord(word.en);
  if (slug && !index.has(slug)) index.set(slug, word);
}

function extraByLemma(rows: UserWordRow[]): Map<string, DictWord> {
  const index = new Map<string, DictWord>();
  for (const row of rows) {
    indexUserWord(index, {
      id: row.word_id,
      en: row.en,
      ru: row.ru,
      example: row.example,
      level: row.level as DictWord["level"],
    });
  }
  return index;
}

function matchExtra(token: string, extraIndex: Map<string, DictWord>): DictWord | undefined {
  for (const variant of variants(token)) {
    const hit = extraIndex.get(variant) ?? extraIndex.get(lemmaHead(variant)) ?? extraIndex.get(slugWord(variant));
    if (hit) return hit;
  }
  return undefined;
}

export async function wordsInBody(body: string, extraIndex: Map<string, DictWord>): Promise<DictWord[]> {
  const { matched } = await matchTokens(body, extraIndex);
  return matched;
}

function storedWordIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function matchTokens(
  body: string,
  extraIndex: Map<string, DictWord>,
): Promise<{ matched: DictWord[]; unknown: string[] }> {
  const matched: DictWord[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  const handled = new Set<string>();
  const hits: SenseHit[] = [];
  const push = (word: DictWord | undefined) => {
    if (!word || seen.has(word.id)) return;
    seen.add(word.id);
    matched.push(word);
  };

  const pieces = splitSentences(body);
  for (const sentence of pieces.length > 0 ? pieces : [body]) {
    for (const token of extractTokens(sentence)) {
      const senses = catalogSenses(token);
      if (senses.length > 1) {
        hits.push({ token, sentence: clipSentence(sentence), senses });
        continue;
      }
      if (handled.has(token)) continue;
      handled.add(token);
      if (senses.length === 1) {
        push(senses[0]);
        continue;
      }
      const own = matchExtra(token, extraIndex);
      if (own) push(own);
      else unknown.push(token);
    }
  }
  for (const word of await resolveSenses(hits)) push(word);
  return { matched, unknown };
}

export async function loadTextPack(user: AppUser, themeId: string): Promise<DictTheme | undefined> {
  const textId = parseTextThemeId(themeId);
  if (!textId) return undefined;
  const rows = await sql<{ id: string; title: string; body: string; word_ids: unknown }[]>`
    SELECT id, title, body, word_ids
    FROM user_texts
    WHERE id = ${textId}::bigint AND user_id = ${user.id}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return undefined;
  const title = textPackTitle(row.title, row.body);
  const extraIndex = extraByLemma(await loadUserWordRows(user.id));
  const stored = storedWordIds(row.word_ids);
  let words: DictWord[];
  if (stored) {
    words = stored
      .map((id) => dictionary.getWord(id) ?? extraIndex.get(id))
      .filter((word): word is DictWord => Boolean(word));
  } else {
    words = await wordsInBody(row.body, extraIndex);
    await sql`
      UPDATE user_texts
      SET word_ids = ${sql.json(words.map((word) => word.id))}
      WHERE id = ${row.id}::bigint AND user_id = ${user.id}::bigint
    `;
  }
  return {
    id: themeId,
    title,
    paid: false,
    blockId: "texts",
    words,
    kind: "text",
  };
}

export async function analyzeTexts(user: AppUser, inputs: TextInput[]): Promise<TextAnalysis> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new HttpError("Добавь хотя бы один текст", 400, "bad_request");
  }
  const quota = await textQuota(user, 0);
  if (inputs.length > quota.maxTexts) {
    throw new HttpError(
      user.subscribed
        ? `Можно загрузить не больше ${quota.maxTexts} текстов за раз`
        : "Без подписки можно разобрать 1 свой текст.",
      400,
      "bad_request",
    );
  }

  const cleaned: { title: string; body: string }[] = [];
  for (const [index, item] of inputs.entries()) {
    const body = String(item?.body ?? "").trim();
    if (!body) continue;
    if (body.length > quota.maxChars) {
      throw new HttpError(
        user.subscribed
          ? `Текст ${index + 1} слишком длинный`
          : `Без подписки текст — до ${quota.maxChars} знаков`,
        400,
        "bad_request",
      );
    }
    cleaned.push({
      title: titleFrom(String(item.title || body), `Текст ${index + 1}`),
      body,
    });
  }
  if (cleaned.length === 0) {
    throw new HttpError("Добавь хотя бы один текст", 400, "bad_request");
  }

  const savedRows = await sql<{ id: string; body: string }[]>`
    SELECT id, body FROM user_texts
    WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()} AND btrim(body) <> ''
  `;
  const savedBodyIds = new Map(savedRows.map((row) => [row.body, String(row.id)]));
  const newBodyCount = new Set(cleaned.map((item) => item.body).filter((body) => !savedBodyIds.has(body))).size;
  if (savedRows.length + newBodyCount > quota.maxTexts) {
    throw new HttpError(
      user.subscribed
        ? `Можно хранить не больше ${quota.maxTexts} текстов. Удали лишние.`
        : "Без подписки можно разобрать 1 свой текст. Удали сохранённый или оформи доступ.",
      400,
      "bad_request",
    );
  }
  if (quota.monthlyLimit !== null && newBodyCount > 0 && quota.monthlyUsed + newBodyCount > quota.monthlyLimit) {
    const left = Math.max(0, quota.monthlyLimit - quota.monthlyUsed);
    throw new HttpError(
      left > 0
        ? `По подписке — ${quota.monthlyLimit} новых текста за ${quota.windowDays} дней. Сейчас можно добавить ещё ${left}.`
        : `По подписке — ${quota.monthlyLimit} новых текста за ${quota.windowDays} дней. Следующий можно добавить ${
            quota.nextAt ? formatRuDate(quota.nextAt) : "позже"
          }.`,
      429,
      "text_quota",
    );
  }

  const combined = cleaned.map((item) => item.body).join("\n");
  const tokens = extractTokens(combined);
  const matched: DictWord[] = [];
  const unknown: string[] = [];
  const seenIds = new Set<string>();
  const unknownSeen = new Set<string>();
  const extraRows = await loadUserWordRows(user.id);
  const extraIndex = extraByLemma(extraRows);
  const perText: DictWord[][] = [];

  for (const item of cleaned) {
    const found = await matchTokens(item.body, extraIndex);
    perText.push(found.matched);
    for (const word of found.matched) {
      if (seenIds.has(word.id)) continue;
      seenIds.add(word.id);
      matched.push(word);
    }
    for (const token of found.unknown) {
      if (unknownSeen.has(token)) continue;
      unknownSeen.add(token);
      unknown.push(token);
    }
  }

  const fromWiki: { token: string; resolved: { existing?: DictWord; created?: DictWord } }[] = [];
  const pending: string[] = [];
  for (const token of unknown) {
    const entry = lookupWiktionary(token);
    if (!entry) {
      pending.push(token);
      continue;
    }
    fromWiki.push({ token, resolved: wordFromWiktionary(entry, token, combined) });
  }

  let classified: ClassifiedWord[] = [];
  if (activeLanguage() === "en" && pending.length > 0) {
    try {
      classified = await classifyUnknown(pending);
    } catch (error) {
      console.error("AI classify skipped", error);
      classified = [];
    }
  }

  const addedWords: TextAnalysis["addedWords"] = [];
  const addedByTheme = new Map<string, number>();
  const fromLemma: { token: string; word: DictWord }[] = [];
  let recovered = 0;

  const resolvedWords = [
    ...fromWiki,
    ...classified.map((word) => ({
      token: word.token || word.en,
      resolved: dictWordFromLemma(word, combined, extraIndex),
    })),
  ];

  for (const item of resolvedWords) {
    const resolved = item.resolved;
    if (resolved.existing) {
      recovered += 1;
      fromLemma.push({ token: item.token, word: resolved.existing });
      if (!seenIds.has(resolved.existing.id)) {
        seenIds.add(resolved.existing.id);
        matched.push(resolved.existing);
      }
      continue;
    }
    const created = resolved.created;
    if (!created) continue;
    if (seenIds.has(created.id)) {
      recovered += 1;
      continue;
    }
    const published = await fileCatalogLemma(created, "text", user.language);
    const home = dictionary.getTheme(published.themeId);
    if (!home || dictionary.isMediaPack(home)) continue;
    await sql`
      INSERT INTO user_words (user_id, language, word_id, theme_id, en, ru, example, level)
      VALUES (
        ${user.id}::bigint,
        ${user.language || activeLanguage()},
        ${created.id},
        ${home.id},
        ${created.en},
        ${created.ru},
        ${created.example},
        ${created.level}
      )
      ON CONFLICT (user_id, language, word_id, theme_id) DO UPDATE SET
        en = EXCLUDED.en,
        ru = EXCLUDED.ru,
        example = EXCLUDED.example,
        level = EXCLUDED.level
    `;
    recovered += 1;
    seenIds.add(created.id);
    matched.push(created);
    fromLemma.push({ token: item.token, word: created });
    indexUserWord(extraIndex, created);
    if (!published.inserted) continue;
    addedByTheme.set(home.id, (addedByTheme.get(home.id) ?? 0) + 1);
    addedWords.push({
      id: created.id,
      en: created.en,
      ru: created.ru,
      themeId: home.id,
      themeTitle: home.title,
    });
  }

  for (const [index, item] of cleaned.entries()) {
    const list = perText[index] ?? [];
    const body = item.body.toLowerCase();
    for (const found of fromLemma) {
      if (!body.includes(found.token.toLowerCase())) continue;
      if (list.some((word) => word.id === found.word.id)) continue;
      list.push(found.word);
    }
    perText[index] = list;
  }

  const textIds: string[] = [];
  const usedBodies = new Set<string>();
  for (const [index, item] of cleaned.entries()) {
    if (usedBodies.has(item.body)) continue;
    usedBodies.add(item.body);
    const wordIds = (perText[index] ?? []).map((word) => word.id);
    const existingId = savedBodyIds.get(item.body);
    if (existingId) {
      await sql`
        UPDATE user_texts
        SET word_ids = ${sql.json(wordIds)}
        WHERE id = ${existingId}::bigint AND user_id = ${user.id}::bigint
      `;
      textIds.push(existingId);
      continue;
    }
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO user_texts (user_id, language, title, body, word_ids)
      VALUES (${user.id}::bigint, ${activeLanguage()}, ${item.title}, ${item.body}, ${sql.json(wordIds)})
      RETURNING id
    `;
    if (inserted[0]) {
      const id = String(inserted[0].id);
      savedBodyIds.set(item.body, id);
      textIds.push(id);
      await recordTextUpload(user.id, id);
    }
  }

  const known = await knownIds(user.id);
  const extras = extrasByTheme(await loadUserWordRows(user.id));
  const hits = new Map<string, { word: DictWord; known: boolean }[]>();

  for (const word of matched) {
    const themeIds = new Set(dictionary.themesFor(word.id));
    for (const [themeId, list] of extras) {
      if (list.some((item) => item.id === word.id)) themeIds.add(themeId);
    }
    if (themeIds.size === 0) themeIds.add("general");
    for (const themeId of themeIds) {
      const theme = dictionary.getTheme(themeId);
      if (!theme || dictionary.isMediaPack(theme)) continue;
      const list = hits.get(themeId) ?? [];
      list.push({ word, known: known.has(word.id) });
      hits.set(themeId, list);
    }
  }

  const recommendations: ThemeRecommendation[] = [...hits.entries()]
    .map(([themeId, list]) => {
      const theme = dictionary.getTheme(themeId);
      if (!theme) return null;
      const unique = new Map<string, { word: DictWord; known: boolean }>();
      for (const item of list) unique.set(item.word.id, item);
      const items = [...unique.values()];
      const unknownCount = items.filter((item) => !item.known).length;
      return {
        themeId,
        title: theme.title,
        locked: themeLocked(theme, user),
        inText: items.length,
        known: items.length - unknownCount,
        unknown: unknownCount,
        added: addedByTheme.get(themeId) ?? 0,
        sample: items
          .filter((item) => !item.known)
          .slice(0, 6)
          .map((item) => item.word.en),
      } satisfies ThemeRecommendation;
    })
    .filter((item): item is ThemeRecommendation => Boolean(item))
    .sort((a, b) => b.unknown - a.unknown || b.inText - a.inText)
    .slice(0, 12);

  const analysis: TextAnalysis = {
    uniqueWords: tokens.length,
    matched: matched.length,
    added: addedWords.length,
    skipped: Math.max(0, unknown.length - recovered),
    usedAi: classified.length > 0,
    textIds,
    recommendations,
    addedWords,
  };

  await sql`
    INSERT INTO user_text_runs (user_id, language, result, updated_at)
    VALUES (${user.id}::bigint, ${activeLanguage()}, ${sql.json(analysis as never)}, now())
    ON CONFLICT (user_id, language) DO UPDATE SET result = EXCLUDED.result, updated_at = now()
  `;

  invalidateThemeCatalog(user.id);
  return analysis;
}
