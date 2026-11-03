import { sql } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Turns a one-time username grant into a normal paid subscription row. */
export async function applyManualAccess(userId: string, username: string | null): Promise<void> {
  const name = username?.trim().replace(/^@/, "").toLowerCase() ?? "";
  if (!name) return;

  await sql.begin(async (tx) => {
    const claimed = await tx<{ id: string; period: string }[]>`
      UPDATE manual_access
      SET applied_user_id = ${userId}::bigint,
          applied_at = now()
      WHERE lower(username) = ${name}
        AND applied_at IS NULL
      RETURNING id, period
    `;
    const grant = claimed[0];
    if (!grant) return;

    const days = grant.period === "yearly" ? 365 : 30;
    const latest = await tx<{ expires_at: Date }[]>`
      SELECT expires_at FROM subscriptions
      WHERE user_id = ${userId}::bigint
      ORDER BY expires_at DESC
      LIMIT 1
    `;
    const now = new Date();
    const current = latest[0]?.expires_at ?? null;
    const base = current && current.getTime() > now.getTime() ? current : now;
    const expiresAt = new Date(base.getTime() + days * DAY_MS);

    await tx`
      INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at, cancelled_at)
      VALUES (
        ${userId}::bigint,
        ${-Number(grant.id)},
        ${grant.period},
        'regular',
        ${expiresAt},
        NULL
      )
    `;
  });
}
