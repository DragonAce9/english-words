import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { makeInitData } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { migrate } from "./migrate.js";
import { catalogFromRecords, resetWordtronCache, useWordtronFixture } from "./wordtron.js";

const app = createApp();
const testerId = 9_001_888;
const strangerId = 9_001_889;
const botToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;
const secret = "apple";

const fixture = catalogFromRecords(
  "en",
  [secret, "pear", "near", "mid", "farther", "around", "wide", "chair"],
  [
    {
      id: "apple",
      word: secret,
      translation: "яблоко",
      pos: "n",
      level: "A1",
      themeTitle: "Еда",
      ranks: {
        apple: 1,
        pear: 4,
        near: 11,
        mid: 400,
        farther: 800,
        around: 1000,
        wide: 2000,
      },
    },
  ],
);

function headersFor(telegramUserId: number) {
  return { Authorization: `tma ${makeInitData(botToken, telegramUserId)}` };
}

async function request(telegramUserId: number, path: string, init?: RequestInit) {
  const response = await app.request(path, {
    ...init,
    headers: {
      ...headersFor(telegramUserId),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

async function wipe(telegramUserId: number) {
  await sql`
    DELETE FROM wordtron_games
    WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
  `;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
}

beforeAll(async () => {
  process.env.WORDTRON_TESTER_IDS = String(testerId);
  useWordtronFixture(fixture);
  await migrate();
  await wipe(testerId);
  await wipe(strangerId);
});

afterAll(async () => {
  await wipe(testerId);
  await wipe(strangerId);
  resetWordtronCache();
  delete process.env.WORDTRON_TESTER_IDS;
});

describe("wordtron", () => {
  it("hides the preview from someone who is not a tester", async () => {
    const me = await request(strangerId, "/me");
    expect(me.status).toBe(200);
    expect(me.body.wordtronPreview).toBe(false);
    const blocked = await request(strangerId, "/wordtron");
    expect(blocked.status).toBe(404);
  });

  it("does not count an unknown word, a repeat, and does count a far word", async () => {
    const started = await request(testerId, "/wordtron/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(started.status).toBe(200);

    const unknown = await request(testerId, "/wordtron/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: "zzzzzz" }),
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.result).toBe("unknown");
    expect(unknown.body.message).toBe("не знаю такого слова");
    expect((unknown.body.game as { attempts: number }).attempts).toBe(0);

    const far = await request(testerId, "/wordtron/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: "chair" }),
    });
    expect(far.body.result).toBe("far");
    expect(far.body.message).toBe("далеко (>5000)");
    expect((far.body.game as { attempts: number }).attempts).toBe(1);

    const again = await request(testerId, "/wordtron/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: " chair " }),
    });
    expect(again.body.result).toBe("repeat");
    expect((again.body.game as { attempts: number }).attempts).toBe(1);
  });

  it("restores the unfinished game with the same guesses", async () => {
    const restored = await request(testerId, "/wordtron");
    expect(restored.status).toBe(200);
    expect(restored.body.wordtronPreview).toBeUndefined();
    const game = restored.body.game as { status: string; guesses: { word: string }[]; attempts: number };
    expect(game.status).toBe("playing");
    expect(game.attempts).toBe(1);
    expect(game.guesses.map((guess) => guess.word)).toEqual(["chair"]);
    const me = await request(testerId, "/me");
    expect(me.body.wordtronPreview).toBe(true);
  });

  it("raises the closer-hint cost and never returns a rank under 10", async () => {
    const costs = [3, 5, 8, 11];
    let hintCost = 0;
    let seen = new Set<string>();
    for (const cost of costs) {
      const hinted = await request(testerId, "/wordtron/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "closer" }),
      });
      expect(hinted.status).toBe(200);
      const game = hinted.body.game as {
        hintCost: number;
        guesses: { word: string; rank: number | null; hint: boolean }[];
      };
      expect(game.hintCost).toBe(hintCost + cost);
      hintCost = game.hintCost;
      const added = game.guesses.filter((guess) => guess.hint && !seen.has(guess.word));
      expect(added).toHaveLength(1);
      expect(added[0]?.word).not.toBe("pear");
      expect(added[0]?.rank ?? 0).toBeGreaterThanOrEqual(10);
      seen = new Set(game.guesses.filter((guess) => guess.hint).map((guess) => guess.word));
    }
    const game = (
      await request(testerId, "/wordtron")
    ).body.game as { guesses: { word: string; rank: number | null; hint: boolean }[]; nextCloserCost: number };
    expect(game.nextCloserCost).toBe(14);
    const hintedWords = game.guesses.filter((guess) => guess.hint).map((guess) => guess.word);
    expect(hintedWords).not.toContain("pear");
    expect(new Set(hintedWords).size).toBe(hintedWords.length);
  });

  it("ends the game when the secret is guessed", async () => {
    const won = await request(testerId, "/wordtron/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: " The Apple " }),
    });
    expect(won.status).toBe(200);
    expect(won.body.result).toBe("win");
    const game = won.body.game as {
      status: string;
      passport: { word: string; translation: string; transcription: string | null; shareText: string } | null;
    };
    expect(game.status).toBe("won");
    expect(game.passport?.word).toBe(secret);
    expect(game.passport?.translation).toBe("яблоко");
    expect(game.passport?.transcription).toBeNull();
    expect(game.passport?.shareText).toContain("угадал");
    expect(game.passport?.shareText.toLowerCase()).not.toContain(secret);
  });

  it("reveals the word on surrender without putting it in the share text", async () => {
    const started = await request(testerId, "/wordtron/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(started.status).toBe(200);
    const given = await request(testerId, "/wordtron/surrender", { method: "POST" });
    expect(given.status).toBe(200);
    const game = given.body.game as {
      status: string;
      passport: { word: string; shareText: string } | null;
    };
    expect(game.status).toBe("surrendered");
    expect(game.passport?.word).toBe(secret);
    expect(game.passport?.shareText).toContain("сдался");
    expect(game.passport?.shareText.toLowerCase()).not.toContain(secret);
  });

  it("lets two bots answer a counted guess without raising the human score", async () => {
    const started = await request(testerId, "/wordtron/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bots: 2 }),
    });
    expect(started.status).toBe(200);
    const gameStart = started.body.game as { opponents: string[]; bots: number };
    expect(gameStart.bots).toBe(2);
    expect(gameStart.opponents).toEqual(["Мира", "Глеб"]);

    const unknown = await request(testerId, "/wordtron/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: "zzzzzz" }),
    });
    const quiet = unknown.body.game as { attempts: number; guesses: { bot: string | null }[] };
    expect(quiet.attempts).toBe(0);
    expect(quiet.guesses.filter((guess) => guess.bot)).toHaveLength(0);

    const guessed = await request(testerId, "/wordtron/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: "chair" }),
    });
    const game = guessed.body.game as {
      attempts: number;
      guesses: { word: string; rank: number | null; bot: string | null; botName: string | null; hint: boolean }[];
    };
    expect(game.attempts).toBe(1);
    const bots = game.guesses.filter((guess) => guess.bot);
    expect(new Set(bots.map((guess) => guess.botName))).toEqual(new Set(["Мира", "Глеб"]));
    for (const bot of bots) {
      expect(bot.hint).toBe(false);
      expect(bot.word).not.toBe(secret);
      expect(bot.word).not.toBe("pear");
      expect(bot.rank ?? 0).toBeGreaterThanOrEqual(10);
    }
    expect(new Set(bots.map((guess) => guess.word)).size).toBe(2);

    const restored = await request(testerId, "/wordtron");
    const again = restored.body.game as { opponents: string[]; guesses: { word: string; bot: string | null }[] };
    expect(again.opponents).toEqual(["Мира", "Глеб"]);
    expect(again.guesses.filter((guess) => guess.bot).map((guess) => guess.word)).toEqual(bots.map((guess) => guess.word));
  });
});
