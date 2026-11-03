import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { sql } from "./db.js";
import type { SubscriptionPeriod, SubscriptionType } from "./types.js";

export function verifyTributeSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", config.tributeApiKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bodyHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

function eventId(event: TributeEvent, rawBody: string): string {
  const payload = event.payload ?? {};
  return (
    String(payload.event_id ?? "") ||
    String(event.id ?? "") ||
    `${event.name}:${payload.purchase_id ?? payload.subscription_id ?? ""}:${event.sent_at ?? event.created_at ?? bodyHash(rawBody)}`
  );
}

function periodDays(period: SubscriptionPeriod): number {
  return period === "yearly" ? 365 : 30;
}

/** Map Tribute digital product id → access period. */
export function periodForProductId(productId: number): SubscriptionPeriod | null {
  if (productId === config.tributeProductMonthlyId) return "monthly";
  if (productId === config.tributeProductYearlyId) return "yearly";
  return null;
}

export function productLink(productId: number): string {
  return `https://telegram.me/tribute/app?startapp=p${productId}`;
}

interface TributePayload {
  event_id?: string;
  subscription_id?: number | string;
  purchase_id?: number | string;
  product_id?: number | string;
  telegram_user_id?: number | string;
  period?: string;
  type?: string;
  expires_at?: string;
  cancelled_at?: string;
  amount?: number;
  currency?: string;
}

interface TributeEvent {
  id?: string | number;
  name?: string;
  created_at?: string;
  sent_at?: string;
  payload?: TributePayload;
}

async function upsertUser(telegramUserId: number): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO users (telegram_user_id)
    VALUES (${telegramUserId})
    ON CONFLICT (telegram_user_id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id
    RETURNING id
  `;
  return String(rows[0].id);
}

async function latestExpiry(userId: string): Promise<Date | null> {
  const rows = await sql<{ expires_at: Date }[]>`
    SELECT expires_at FROM subscriptions
    WHERE user_id = ${userId}::bigint
    ORDER BY expires_at DESC
    LIMIT 1
  `;
  return rows[0]?.expires_at ?? null;
}

async function upsertPurchase(input: {
  userId: string;
  purchaseId: number;
  period: SubscriptionPeriod;
  type: SubscriptionType;
  expiresAt: Date;
}): Promise<void> {
  await sql`
    INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at, cancelled_at)
    VALUES (
      ${input.userId}::bigint,
      ${input.purchaseId},
      ${input.period},
      ${input.type},
      ${input.expiresAt},
      NULL
    )
    ON CONFLICT (tribute_subscription_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      period = EXCLUDED.period,
      type = EXCLUDED.type,
      expires_at = EXCLUDED.expires_at,
      cancelled_at = NULL
  `;
}

async function grantDigitalAccess(payload: TributePayload): Promise<{ ok: true; ignored?: boolean }> {
  const telegramUserId = Number(payload.telegram_user_id);
  const productId = Number(payload.product_id);
  const purchaseId = Number(payload.purchase_id ?? payload.subscription_id);
  if (!Number.isFinite(telegramUserId) || !Number.isFinite(productId) || !Number.isFinite(purchaseId)) {
    return { ok: true, ignored: true };
  }

  const period = periodForProductId(productId);
  if (!period) {
    console.warn(`tribute: unknown digital product_id=${productId}, ignoring`);
    return { ok: true, ignored: true };
  }

  const userId = await upsertUser(telegramUserId);
  const now = new Date();
  const current = await latestExpiry(userId);
  const base = current && current.getTime() > now.getTime() ? current : now;
  const expiresAt = new Date(base.getTime() + periodDays(period) * 24 * 60 * 60 * 1000);

  await upsertPurchase({
    userId,
    purchaseId,
    period,
    type: "regular",
    expiresAt,
  });
  return { ok: true };
}

async function refundDigitalAccess(payload: TributePayload): Promise<{ ok: true; ignored?: boolean }> {
  const purchaseId = Number(payload.purchase_id ?? payload.subscription_id);
  if (!Number.isFinite(purchaseId)) return { ok: true, ignored: true };
  const now = new Date();
  await sql`
    UPDATE subscriptions
    SET cancelled_at = COALESCE(cancelled_at, ${now}),
        expires_at = LEAST(expires_at, ${now})
    WHERE tribute_subscription_id = ${purchaseId}
  `;
  return { ok: true };
}

export async function handleTributeWebhook(
  rawBody: string,
  signature: string | undefined,
): Promise<{ ok: true; duplicate?: boolean; ignored?: boolean }> {
  if (!verifyTributeSignature(rawBody, signature)) {
    const error = new Error("Invalid Tribute signature");
    (error as Error & { status: number }).status = 401;
    throw error;
  }

  let event: TributeEvent;
  try {
    event = JSON.parse(rawBody) as TributeEvent;
  } catch {
    const error = new Error("Invalid JSON");
    (error as Error & { status: number }).status = 400;
    throw error;
  }

  const id = eventId(event, rawBody);
  const hash = bodyHash(rawBody);

  const inserted = await sql<{ event_id: string }[]>`
    INSERT INTO tribute_events (event_id, event_name, body_hash)
    VALUES (${id}, ${event.name ?? "unknown"}, ${hash})
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  if (inserted.length === 0) return { ok: true, duplicate: true };

  const name = event.name ?? "";
  const payload = event.payload ?? {};

  if (name === "new_digital_product") {
    return grantDigitalAccess(payload);
  }

  if (name === "digital_product_refund") {
    return refundDigitalAccess(payload);
  }

  // Legacy channel subscription events — ignored after digital-product switch.
  if (
    name === "new_subscription" ||
    name === "renewed_subscription" ||
    name === "cancelled_subscription"
  ) {
    console.warn(`tribute: ignoring legacy channel event ${name}`);
    return { ok: true, ignored: true };
  }

  return { ok: true, ignored: true };
}

export function signTributeBody(rawBody: string, apiKey = config.tributeApiKey): string {
  return createHmac("sha256", apiKey).update(rawBody).digest("hex");
}
