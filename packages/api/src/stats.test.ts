import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { makeInitData } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { migrate } from "./migrate.js";
import type { UserStats } from "./types.js";

const app = createApp();
const telegramUserId = 9_001_006;
const botToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;

function authHeaders() {
  if (config.allowDevAuth && config.botToken.includes("replace-me")) {
    return { Authorization: "dev" };
  }
  return { Authorization: `tma ${makeInitData(botToken, telegramUserId)}` };
}

async function request(path: string, init?: RequestInit) {
  const response = await app.request(path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  await migrate();
  if (dictionary.words.size === 0) await dictionary.load();
  await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM pets WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
});

afterAll(async () => {
  await sql`DELETE FROM word_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM pets WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
});

describe("user stats", () => {
  it("starts empty and then counts known words, accuracy and the theme", async () => {
    const empty = await request("/stats");
    expect(empty.status).toBe(200);
    const blank = empty.body as UserStats;
    expect(blank.known).toBe(0);
    expect(blank.examined).toBe(0);
    expect(blank.accuracy).toBeNull();
    expect(blank.streak).toBe(0);
    expect(blank.week).toHaveLength(7);
    expect(blank.total).toBeGreaterThan(1000);

    const saved = await request("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { wordId: "one", themeId: "numbers", correct: 3, wrong: 1, known: true },
          { wordId: "two", themeId: "numbers", correct: 1, wrong: 1, known: false },
        ],
      }),
    });
    expect(saved.status).toBe(200);

    const filled = await request("/stats");
    expect(filled.status).toBe(200);
    const stats = filled.body as UserStats;
    expect(stats.known).toBe(1);
    expect(stats.examined).toBe(0);
    expect(stats.learning).toBe(1);
    expect(stats.correct).toBe(4);
    expect(stats.wrong).toBe(2);
    expect(stats.accuracy).toBe(67);
    expect(stats.coins).toBe(30);
    expect(stats.streak).toBeGreaterThanOrEqual(1);
    expect(stats.week.reduce((sum, day) => sum + day.count, 0)).toBe(2);
    expect(stats.themes.some((theme) => theme.id === "numbers" && theme.known >= 1)).toBe(true);
    const numbers = stats.levels.find((level) => level.level === "A1");
    expect(numbers?.known).toBeGreaterThanOrEqual(1);

    const passed = await request("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "one", themeId: "exam", correct: 2, wrong: 0, known: true, awardCoins: false, examined: true }],
      }),
    });
    expect(passed.status).toBe(200);
    const confirmed = (await request("/stats")).body as UserStats;
    expect(confirmed.known).toBe(1);
    expect(confirmed.examined).toBe(1);

    const missed = await request("/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ wordId: "one", themeId: "exam", correct: 1, wrong: 1, known: false, awardCoins: false, demote: true }],
      }),
    });
    expect(missed.status).toBe(200);
    const afterMiss = (await request("/stats")).body as UserStats;
    expect(afterMiss.known).toBe(0);
    expect(afterMiss.examined).toBe(0);
  });
});
