import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import type { AppUser, CefrLevel, UserStats, UserStatsDay } from "./types.js";
import { CEFR_LEVELS } from "./types.js";

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

interface ProgressRow {
  word_id: string;
  status: string;
  examined: boolean;
  correct_count: number;
  wrong_count: number;
  day: string;
}

function moscowToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}

function shiftDay(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

function weekdayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
}

function streakEnding(days: Set<string>, today: string): number {
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  if (!days.has(cursor)) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

export async function loadUserStats(user: AppUser): Promise<UserStats> {
  const rows = await sql<ProgressRow[]>`
    SELECT word_id, status, examined, correct_count, wrong_count,
           (updated_at AT TIME ZONE 'Europe/Moscow')::date::text AS day
    FROM word_progress
    WHERE user_id = ${user.id}::bigint AND language = ${activeLanguage()}
  `;
  const coinsRows = await sql<{ coins: number }[]>`
    SELECT coins FROM pets WHERE user_id = ${user.id}::bigint
  `;

  const known = new Set<string>();
  const examined = new Set<string>();
  const learning = new Set<string>();
  const days = new Set<string>();
  const practiced = new Map<string, number>();
  let correct = 0;
  let wrong = 0;

  for (const row of rows) {
    const wordId = dictionary.resolveWordId(row.word_id);
    if (!dictionary.words.has(wordId)) continue;
    correct += row.correct_count;
    wrong += row.wrong_count;
    days.add(row.day);
    practiced.set(row.day, (practiced.get(row.day) ?? 0) + 1);
    if (row.status === "known") {
      known.add(wordId);
      if (row.examined) examined.add(wordId);
    } else learning.add(wordId);
  }
  for (const id of known) learning.delete(id);

  const levelKnown = new Map<CefrLevel, number>();
  const levelTotal = new Map<CefrLevel, number>();
  for (const level of CEFR_LEVELS) {
    levelKnown.set(level, 0);
    levelTotal.set(level, 0);
  }
  for (const word of dictionary.words.values()) {
    levelTotal.set(word.level, (levelTotal.get(word.level) ?? 0) + 1);
  }
  for (const id of known) {
    const level = dictionary.getWord(id)?.level;
    if (level) levelKnown.set(level, (levelKnown.get(level) ?? 0) + 1);
  }

  const themes = dictionary
    .listThemes()
    .filter((theme) => !theme.kind && !theme.showId)
    .map((theme) => {
      const ids = new Set(theme.words.map((word) => dictionary.resolveWordId(word.id)));
      let themeKnown = 0;
      for (const id of ids) if (known.has(id)) themeKnown += 1;
      return { id: theme.id, title: theme.title, known: themeKnown, total: ids.size };
    })
    .filter((theme) => theme.known > 0 && theme.total > 0)
    .sort((a, b) => b.known / b.total - a.known / a.total || b.known - a.known)
    .slice(0, 6);

  const today = moscowToday();
  const week: UserStatsDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset);
    week.push({ day, label: weekdayLabel(day), count: practiced.get(day) ?? 0 });
  }

  const answered = correct + wrong;
  return {
    known: known.size,
    examined: examined.size,
    total: dictionary.words.size,
    learning: learning.size,
    correct,
    wrong,
    accuracy: answered === 0 ? null : Math.round((100 * correct) / answered),
    coins: coinsRows[0]?.coins ?? 0,
    streak: streakEnding(days, today),
    activeDays: days.size,
    week,
    levels: CEFR_LEVELS.map((level) => ({
      level,
      known: levelKnown.get(level) ?? 0,
      total: levelTotal.get(level) ?? 0,
    })),
    themes,
  };
}
