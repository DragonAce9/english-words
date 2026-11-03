import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { makeInitData } from "./auth.js";
import {
  catalogRequesterId,
  createCatalogRequest,
  formatCatalogRequestMessage,
  setCatalogRequestNotifier,
} from "./catalogRequests.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { migrate } from "./migrate.js";

const app = createApp();
const telegramUserId = 9_001_077;
const botToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;
const titles = ["Проверка заявки", "Без telegram id", "Служебная заявка"];

function authHeaders() {
  if (config.allowDevAuth && config.botToken.includes("replace-me")) {
    return { Authorization: "dev" };
  }
  return { Authorization: `tma ${makeInitData(botToken, telegramUserId)}` };
}

function sessionTelegramId(): number {
  if (config.allowDevAuth && config.botToken.includes("replace-me")) return config.devTelegramUserId;
  return telegramUserId;
}

async function post(body: unknown) {
  const response = await app.request("/catalog-requests", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as { ok?: boolean; error?: string } };
}

beforeAll(async () => {
  await migrate();
  await sql`DELETE FROM catalog_requests WHERE title = ANY(${titles})`;
  if (!(config.allowDevAuth && config.botToken.includes("replace-me"))) {
    await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
  }
});

afterAll(async () => {
  setCatalogRequestNotifier(null);
  await sql`DELETE FROM catalog_requests WHERE title = ANY(${titles})`;
  if (!(config.allowDevAuth && config.botToken.includes("replace-me"))) {
    await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
  }
  await sql.end({ timeout: 5 });
});

describe("catalog requests", () => {
  it("uses the dev user id when the session has none", () => {
    expect(catalogRequesterId(42)).toBe(42);
    expect(catalogRequesterId(0)).toBe(config.devTelegramUserId);
    expect(catalogRequesterId(Number.NaN)).toBe(config.devTelegramUserId);
  });

  it("rejects a missing title and accepts a film request without a live Telegram send", async () => {
    const sent: string[] = [];
    setCatalogRequestNotifier(async (text) => {
      sent.push(text);
    });

    const missing = await post({ kind: "movie", title: "   ", comment: "пусто" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/название/i);
    expect(sent).toEqual([]);

    const created = await post({ kind: "movie", title: "Проверка заявки", comment: "для теста" });
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Заявка на добавление в каталог");
    expect(sent[0]).toContain("Тип: фильм");
    expect(sent[0]).toContain("Название: Проверка заявки");
    expect(sent[0]).toContain("Комментарий: для теста");
    expect(sent[0]).toContain("Язык: Английский");
    expect(sent[0]).toContain(`Telegram id: ${sessionTelegramId()}`);

    const rows = await sql<{ kind: string; telegram_user_id: string }[]>`
      SELECT kind, telegram_user_id::text FROM catalog_requests WHERE title = 'Проверка заявки'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("movie");
    expect(rows[0]?.telegram_user_id).toBe(String(sessionTelegramId()));
  });

  it("stores a request with the dev user id when the session id is missing", async () => {
    const sent: string[] = [];
    setCatalogRequestNotifier(async (text) => {
      sent.push(text);
    });
    const probe = await post({ kind: "series", title: "Служебная заявка" });
    expect(probe.status).toBe(200);
    const user = await sql<{ id: string }[]>`
      SELECT id::text FROM users WHERE telegram_user_id = ${sessionTelegramId()} LIMIT 1
    `;
    expect(user[0]?.id).toBeTruthy();
    await createCatalogRequest(
      {
        id: user[0]!.id,
        telegramUserId: 0,
        subscribed: false,
        freeMediaId: null,
        dev: true,
        onboardingDone: true,
        language: "en",
        languageChosen: false,
      },
      { kind: "series", title: "Без telegram id" },
    );
    const notice = formatCatalogRequestMessage({
      id: "0",
      telegramUserId: config.devTelegramUserId,
      kind: "series",
      title: "Без telegram id",
      comment: "",
      language: "en",
    });
    expect(notice).toContain("Тип: сериал");
    expect(notice).toContain(`Telegram id: ${config.devTelegramUserId}`);
    expect(sent.at(-1)).toBe(notice);
  });
});
