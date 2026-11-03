import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import {
  FACT_TITLE,
  acceptFactText,
  channelWelcomeMessage,
  factChannelMessage,
  factDraft,
  mediaStats,
  moscowClock,
  publishDailyFact,
} from "./dailyFact.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { migrate } from "./migrate.js";

beforeAll(async () => {
  await migrate();
  await dictionary.load();
});

afterAll(async () => {
  await sql`DELETE FROM daily_facts WHERE day IN ('2099-01-01', '2099-01-02')`;
  await sql`DELETE FROM channel_posts WHERE id = 'welcome-test'`;
  await sql.end({ timeout: 5 });
});

describe("daily fact", () => {
  it("counts films and series separately from episode files", () => {
    const stats = mediaStats();
    expect(stats.movieCount).toBeGreaterThan(0);
    expect(stats.seriesCount).toBeGreaterThan(0);
    expect(stats.titleCount).toBe(stats.movieCount + stats.seriesCount);
    expect(stats.packCount).toBeGreaterThan(stats.titleCount);
    expect(stats.uniqueWords).toBeGreaterThan(stats.coreWords);
    expect(stats.coreWords).toBeGreaterThan(0);
    expect(stats.a1a2).toBeGreaterThan(0);
    expect(stats.a1a2).toBeLessThan(stats.uniqueWords);
  });

  it("keeps every stated number inside the draft", () => {
    const start = Date.UTC(2026, 0, 1);
    const kinds = new Set<string>();
    for (let i = 0; i < 16; i += 1) {
      const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      const draft = factDraft(day);
      kinds.add(draft.kind);
      expect(acceptFactText(draft.body, draft.required, draft.extra, draft.anchors), `${draft.kind}: ${draft.body}`).toBe(true);
      const aboutWord = draft.kind === "sense" || draft.kind === "form" || draft.kind === "line" || draft.kind === "word";
      expect(draft.origin).toBe(aboutWord);
    }
    expect(kinds.has("sense")).toBe(true);
    expect(kinds.has("form")).toBe(true);
    expect(kinds.has("line")).toBe(true);
  });

  it("rejects a rewritten fact that adds or drops a number", () => {
    expect(acceptFactText("В каталоге ровно 124 названия, и этого хватает для обычного разговора.", [124])).toBe(true);
    expect(acceptFactText("В каталоге ровно 124 названия и ещё 7 лишних слов для длины текста.", [124])).toBe(false);
    expect(acceptFactText("В каталоге много названий, и этого хватает для обычного разговора сегодня.", [124])).toBe(false);
    expect(
      acceptFactText("В каталоге ровно 124 названия, и этот текст написала нейросеть для поста.", [124]),
    ).toBe(false);
  });

  it("reads Moscow time without daylight saving", () => {
    expect(moscowClock(new Date("2099-01-01T06:30:00Z"))).toEqual({ day: "2099-01-01", hour: 9 });
    expect(moscowClock(new Date("2099-01-01T07:00:00Z"))).toEqual({ day: "2099-01-01", hour: 10 });
  });

  it("posts the stored fact once after 10:00 and skips an empty channel", async () => {
    const previous = config.factChannelId;
    const sent: string[] = [];
    const send = async (text: string) => {
      sent.push(text);
    };
    try {
      (config as { factChannelId: string }).factChannelId = "";
      expect(await publishDailyFact(send, new Date("2099-01-01T07:30:00Z"))).toBe("no-channel");
      expect(sent).toEqual([]);

      (config as { factChannelId: string }).factChannelId = "@facts";
      expect(await publishDailyFact(send, new Date("2099-01-01T06:30:00Z"))).toBe("waiting");
      expect(sent).toEqual([channelWelcomeMessage()]);
      expect(sent[0]).toContain(`@${config.botUsername}`);

      expect(await publishDailyFact(send, new Date("2099-01-01T07:30:00Z"))).toBe("posted");
      expect(sent).toHaveLength(2);
      expect(sent[1]?.startsWith(FACT_TITLE)).toBe(true);
      expect(factChannelMessage("текст").startsWith(FACT_TITLE)).toBe(true);

      expect(await publishDailyFact(send, new Date("2099-01-01T08:00:00Z"))).toBe("already");
      expect(sent).toHaveLength(2);

      await expect(publishDailyFact(async () => {
        throw new Error("channel down");
      }, new Date("2099-01-02T07:30:00Z"))).rejects.toThrow("channel down");
      expect(await publishDailyFact(send, new Date("2099-01-02T07:30:00Z"))).toBe("posted");
      expect(sent).toHaveLength(3);
    } finally {
      (config as { factChannelId: string }).factChannelId = previous;
      await sql`DELETE FROM daily_facts WHERE day IN ('2099-01-01', '2099-01-02')`;
      await sql`DELETE FROM channel_posts WHERE id = 'welcome-test'`;
    }
  });
});
