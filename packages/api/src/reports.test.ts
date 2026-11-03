import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { makeInitData } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { migrate } from "./migrate.js";
import {
  REPORT_NOT_DELIVERED,
  approveWordReport,
  deliverReportToSupport,
  rejectWordReport,
  setReportNotifier,
  setWordReviewer,
  type WordReport,
} from "./reports.js";
import { resetSupportState } from "./support.js";

const app = createApp();
const telegramUserId = 9_001_004;
const botToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;
let originalRu: string[] = [];

function authHeaders() {
  if (config.allowDevAuth && config.botToken.includes("replace-me")) {
    return { Authorization: "dev" };
  }
  return { Authorization: `tma ${makeInitData(botToken, telegramUserId)}` };
}

async function post(body: unknown) {
  const response = await app.request("/reports", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as { ok?: boolean; id?: string; error?: string },
  };
}

async function clearPendingAirport() {
  await sql`DELETE FROM word_reports WHERE word_id = 'airport' AND status = 'pending'`;
}

beforeAll(async () => {
  await migrate();
  if (dictionary.words.size === 0) await dictionary.load();
  originalRu = [...(dictionary.getWord("airport")?.ru ?? [])];
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
});

afterAll(async () => {
  setWordReviewer(null);
  setReportNotifier(null);
  dictionary.setGloss("airport", originalRu);
  await sql`DELETE FROM word_fixes WHERE word_id = 'airport'`;
  await sql`DELETE FROM word_reports WHERE word_id = 'airport'`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
  await sql.end({ timeout: 5 });
});

describe("word reports", () => {
  it("keeps the complaint pending until support approves, then lets AI edit the card", async () => {
    let reviews = 0;
    setWordReviewer(async (report: WordReport) => {
      reviews += 1;
      expect(report.wordId).toBe("airport");
      expect(report.reason).toBe("translation");
      return { apply: true, ru: ["аэровокзал"], themeId: "", note: "Уточнил перевод." };
    });

    const created = await post({ wordId: "airport", themeId: "travel", reason: "translation", comment: "странно" });
    expect(created.status).toBe(200);
    expect(reviews).toBe(0);
    expect(dictionary.getWord("airport")?.ru).toEqual(originalRu);

    const again = await post({ wordId: "airport", themeId: "travel", reason: "category" });
    expect(again.body.id).toBe(created.body.id);
    expect(reviews).toBe(0);

    const approved = await approveWordReport(created.body.id);
    expect(reviews).toBe(1);
    expect(approved.status).toBe("applied");
    expect(dictionary.getWord("airport")?.ru).toEqual(["аэровокзал"]);
    expect(dictionary.getTheme("travel")?.words.find((word) => word.id === "airport")?.ru).toEqual(["аэровокзал"]);

    await expect(approveWordReport(created.body.id)).rejects.toThrow(/уже разобрана/);
    expect(reviews).toBe(1);
  });

  it("does not call AI when support rejects the complaint", async () => {
    let reviews = 0;
    setWordReviewer(async () => {
      reviews += 1;
      return { apply: true, ru: ["нельзя"], themeId: "food", note: "не должно примениться" };
    });
    const created = await post({ wordId: "airport", themeId: "travel", reason: "category" });
    expect(created.status).toBe(200);
    const rejected = await rejectWordReport(created.body.id);
    expect(rejected.status).toBe("rejected");
    expect(reviews).toBe(0);
    expect(dictionary.getWord("airport")?.ru).toEqual(["аэровокзал"]);
  });

  it("hands the complaint to the support sender with the word and comment", async () => {
    await clearPendingAirport();
    const previousSupportId = process.env.SUPPORT_TELEGRAM_USER_ID;
    process.env.SUPPORT_TELEGRAM_USER_ID = "555001";
    const sent: { chatId: number; text: string }[] = [];
    setReportNotifier(async (report) => {
      await deliverReportToSupport(report, {
        getChat: async () => {
          throw new Error("getChat should not run when the numeric support id is set");
        },
        sendMessage: async (chatId, text) => {
          sent.push({ chatId, text });
        },
      });
    });
    try {
      const created = await post({
        wordId: "airport",
        themeId: "travel",
        reason: "example",
        comment: "пример не тот",
      });
      expect(created.status).toBe(200);
      expect(created.body.ok).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.chatId).toBe(555001);
      expect(sent[0]?.text).toContain("airport");
      expect(sent[0]?.text).toContain("Комментарий: пример не тот");
    } finally {
      setReportNotifier(null);
      resetSupportState();
      if (previousSupportId === undefined) delete process.env.SUPPORT_TELEGRAM_USER_ID;
      else process.env.SUPPORT_TELEGRAM_USER_ID = previousSupportId;
    }
  });

  it("does not claim the complaint was sent when Telegram rejects it, and retries the pending row", async () => {
    await clearPendingAirport();
    let calls = 0;
    setReportNotifier(async (report) => {
      calls += 1;
      expect(report.wordId).toBe("airport");
      expect(report.comment).toBe("не дошло");
      throw Object.assign(new Error("sendMessage failed"), { description: "Bad Request: chat not found" });
    });
    try {
      const first = await post({
        wordId: "airport",
        themeId: "travel",
        reason: "translation",
        comment: "не дошло",
      });
      expect(first.status).toBe(502);
      expect(first.body.ok).toBeUndefined();
      expect(first.body.error).toBe(REPORT_NOT_DELIVERED);

      const again = await post({
        wordId: "airport",
        themeId: "travel",
        reason: "translation",
        comment: "не дошло",
      });
      expect(again.status).toBe(502);
      expect(again.body.error).toBe(REPORT_NOT_DELIVERED);
      expect(calls).toBe(2);
    } finally {
      setReportNotifier(null);
    }
  });
});
