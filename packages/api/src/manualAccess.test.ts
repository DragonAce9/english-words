import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeInitData, resolveUser } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { migrate } from "./migrate.js";

const telegramUserId = 9_001_881;
const botToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;

beforeAll(async () => {
  await migrate();
  await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
  await sql`DELETE FROM manual_access WHERE username = 'moti_test_access'`;
});

afterAll(async () => {
  await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})`;
  await sql`DELETE FROM users WHERE telegram_user_id = ${telegramUserId}`;
  await sql`DELETE FROM manual_access WHERE username = 'moti_test_access'`;
  await sql.end({ timeout: 5 });
});

describe("manual access", () => {
  it("grants one paid month once when that Telegram username opens the app", async () => {
    await sql`
      INSERT INTO manual_access (username, period)
      VALUES ('moti_test_access', 'monthly')
    `;
    const initData = makeInitData(botToken, telegramUserId, "Анна", undefined, "Moti_Test_Access");
    const first = await resolveUser(`tma ${initData}`, undefined);
    expect(first.subscribed).toBe(true);

    const rows = await sql<{ period: string; type: string; expires_at: Date; tribute_subscription_id: string }[]>`
      SELECT period, type, expires_at, tribute_subscription_id::text
      FROM subscriptions
      WHERE user_id = ${first.id}::bigint
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].period).toBe("monthly");
    expect(rows[0].type).toBe("regular");
    expect(Number(rows[0].tribute_subscription_id)).toBeLessThan(0);
    const daysLeft = (rows[0].expires_at.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(29);
    expect(daysLeft).toBeLessThan(31);

    await sql`UPDATE subscriptions SET expires_at = now() - interval '1 day' WHERE user_id = ${first.id}::bigint`;
    const second = await resolveUser(`tma ${initData}`, undefined);
    expect(second.subscribed).toBe(false);
  });
});
