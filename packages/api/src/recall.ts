import { canLearnTheme, claimFreeMedia, isMediaTheme } from "./access.js";
import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { stripArticle, targetHead } from "./languages.js";
import { dictionary } from "./dictionary.js";
import { HttpError } from "./httpError.js";
import { shuffle } from "./shuffle.js";
import type { AppUser, CefrLevel, DictTheme, DictWord, SessionWord, WordStatus } from "./types.js";
import { themeForUser } from "./userWords.js";

export type RecallMode = "control" | "review";

type RecallState = {
  status: WordStatus;
  knownOn: string | null;
  controlPassed: boolean;
  controlPassedOn: string | null;
  examPassed: boolean;
};

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function parseDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return value;
}

/**
 * Calendar day as stored. A Postgres `date` arrives as `YYYY-MM-DD`, or as a
 * Date at UTC midnight when the driver parses it. Use that UTC day so
 * “yesterday” stays yesterday in any local timezone.
 */
export function knownDay(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : value.trim();
}

/** A missing day means the word was already known before this calendar day was stored. */
export function knownBeforeDay(knownOn: unknown, today: string): boolean {
  if (knownOn == null || knownOn === "") return true;
  const known = knownDay(knownOn);
  const day = knownDay(today);
  if (!known || !day) return false;
  return known < day;
}

export function normalizeRecall(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** One insertion, deletion, or substitution. A transposition is two edits. */
export function oneEditAway(a: string, b: string): boolean {
  if (a === b) return false;
  const left = a.length;
  const right = b.length;
  if (Math.abs(left - right) > 1) return false;
  if (left === right) {
    let diffs = 0;
    for (let i = 0; i < left; i += 1) {
      if (a[i] !== b[i]) diffs += 1;
      if (diffs > 1) return false;
    }
    return diffs === 1;
  }
  const shorter = left < right ? a : b;
  const longer = left < right ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j += 1;
  }
  return true;
}

export function recallAcceptsAnswer(
  typed: string,
  forms: string[],
  categoryHeads: string[],
  language = activeLanguage(),
): boolean {
  const unique = [...new Set(forms.map((item) => item.trim()).filter(Boolean))];
  return unique.some((form) => recallAnswerCorrect(typed, form, categoryHeads, language));
}

export function recallAnswerCorrect(
  typed: string,
  expected: string,
  categoryHeads: string[],
  language = activeLanguage(),
): boolean {
  const got = stripArticle(typed, language);
  const want = stripArticle(expected, language);
  if (!got || !want) return false;
  if (got === want) return true;
  if (!oneEditAway(got, want)) return false;
  const others = new Set(categoryHeads.map((item) => stripArticle(item, language)).filter((item) => item && item !== want));
  return !others.has(got);
}

export async function openScopedTheme(
  user: AppUser,
  themeId: string,
  level: CefrLevel | null,
  categoryId: string | null,
): Promise<DictTheme> {
  const base = await themeForUser(user, themeId);
  if (!base) throw new HttpError("Theme not found", 404, "not_found");
  if (isMediaTheme(base) && !(await claimFreeMedia(user, base))) {
    throw new HttpError("Subscription required", 403, "subscription_required");
  }
  if (!canLearnTheme(base, user)) {
    throw new HttpError("Subscription required", 403, "subscription_required");
  }
  const words = dictionary.wordsForCategory(base, categoryId);
  if (level && !words.some((word) => word.level === level)) {
    throw new HttpError("No words at this level in the theme", 400, "empty_level");
  }
  if (words.length === 0) {
    throw new HttpError("No words left for this level", 400, "empty_level");
  }
  return { ...base, words };
}

export async function loadRecallStates(userId: string, words: DictWord[]): Promise<Map<string, RecallState>> {
  const rows = await sql<
    {
      word_id: string;
      status: WordStatus;
      known_on: string | null;
      control_passed: boolean;
      control_passed_on: string | null;
      exam_passed: boolean;
    }[]
  >`
    SELECT word_id, status, known_on::text AS known_on, control_passed,
           control_passed_on::text AS control_passed_on, exam_passed
    FROM word_progress
    WHERE user_id = ${userId}::bigint AND language = ${activeLanguage()}
  `;
  const inTheme = new Set(words.map((word) => word.id));
  const states = new Map<string, RecallState>();
  for (const row of rows) {
    const wordId = dictionary.resolveWordId(row.word_id);
    if (!inTheme.has(wordId)) continue;
    const prev = states.get(wordId);
    const known = prev?.status === "known" || row.status === "known";
    if (!known) {
      if (!prev) {
        states.set(wordId, {
          status: row.status,
          knownOn: null,
          controlPassed: false,
          controlPassedOn: null,
          examPassed: false,
        });
      }
      continue;
    }
    if (prev?.status === "known" && row.status !== "known") continue;
    states.set(wordId, {
      status: "known",
      knownOn: knownDay(row.known_on),
      controlPassed: Boolean(row.control_passed),
      controlPassedOn: knownDay(row.control_passed_on),
      examPassed: Boolean(row.exam_passed),
    });
  }
  return states;
}

export function selectRecallWords(
  words: DictWord[],
  states: Map<string, RecallState>,
  level: CefrLevel | null,
  today: string,
  mode: RecallMode,
): SessionWord[] {
  const pool = level ? words.filter((word) => word.level === level) : words;
  const seen = new Set<string>();
  const picked: SessionWord[] = [];
  for (const word of pool) {
    if (seen.has(word.id)) continue;
    seen.add(word.id);
    const state = states.get(word.id);
    if (!state || state.status !== "known") continue;
    if (mode === "review") {
      if (!state.controlPassed || state.examPassed) continue;
      if (!knownBeforeDay(state.controlPassedOn, today)) continue;
    } else if (state.controlPassed || !knownBeforeDay(state.knownOn, today)) {
      continue;
    }
    picked.push({
      id: word.id,
      word: targetHead(word),
      en: word.en || targetHead(word),
      gender: word.gender,
      wordCyrillic: word.wordCyrillic,
      ru: word.ru,
      example: word.example,
      level: word.level,
      pos: word.pos,
      status: "known",
    });
  }
  return shuffle(picked);
}

export async function gradeRecall(
  user: AppUser,
  input: {
    themeId: string;
    mode: RecallMode;
    wordId: string;
    answer: string;
    level: CefrLevel | null;
    categoryId: string | null;
    today: string;
  },
): Promise<{ correct: boolean }> {
  const theme = await openScopedTheme(user, input.themeId, input.level, input.categoryId);
  const wordId = dictionary.resolveWordId(input.wordId);
  const word = theme.words.find((item) => item.id === wordId);
  if (!word) throw new HttpError("Word not found", 404, "not_found");
  const pool = theme.words.flatMap((item) => {
    const forms = [targetHead(item)];
    const cyrillic = item.wordCyrillic?.trim();
    if (cyrillic) forms.push(cyrillic);
    return forms;
  });
  const forms = [targetHead(word)];
  const cyrillic = word.wordCyrillic?.trim();
  if (cyrillic) forms.push(cyrillic);
  const correct = recallAcceptsAnswer(input.answer, forms, pool, user.language);
  if (input.mode === "control" && correct) {
    await sql`
      UPDATE word_progress
      SET control_passed = true,
          control_passed_on = CASE
            WHEN control_passed THEN control_passed_on
            ELSE ${input.today}::date
          END
      WHERE user_id = ${user.id}::bigint
        AND language = ${user.language}
        AND word_id = ${word.id}
        AND status = 'known'
        AND (known_on IS NULL OR known_on < ${input.today}::date)
    `;
  }
  if (input.mode === "control" && !correct) {
    await sql`
      UPDATE word_progress
      SET control_passed = false,
          control_passed_on = NULL
      WHERE user_id = ${user.id}::bigint
        AND language = ${user.language}
        AND word_id = ${word.id}
        AND status = 'known'
        AND (known_on IS NULL OR known_on < ${input.today}::date)
    `;
  }
  if (input.mode === "review" && correct) {
    await sql`
      UPDATE word_progress
      SET exam_passed = true
      WHERE user_id = ${user.id}::bigint
        AND language = ${user.language}
        AND word_id = ${word.id}
        AND status = 'known'
        AND control_passed = true
        AND (control_passed_on IS NULL OR control_passed_on < ${input.today}::date)
    `;
  }
  return { correct };
}
