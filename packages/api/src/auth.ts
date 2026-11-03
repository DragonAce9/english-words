import { createHmac, timingSafeEqual } from "node:crypto";
import { config, isPlaceholderBotToken } from "./config.js";
import { sql } from "./db.js";
import { freeMediaIdFor } from "./access.js";
import { enterLanguage } from "./catalogContext.js";
import { applyManualAccess } from "./manualAccess.js";
import { claimReferralIfNew, grantReferralOnOnboarding, loadReferralUnlocks, upsertTelegramUser } from "./referrals.js";
import { isListedTeacher } from "./teachers.js";
import type { AppUser } from "./types.js";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function initPhotoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https:\/\/\S+$/i.test(trimmed) || trimmed.length > 500) return null;
  if (config.botToken && !config.botToken.includes("replace-me") && trimmed.includes(config.botToken)) return null;
  return trimmed;
}

export function validateInitData(
  initData: string,
  botToken: string,
): { id: number; startParam: string | null; username: string | null; photoUrl: string | null } {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new AuthError("initData hash is missing");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const digest = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AuthError("initData signature is invalid");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new AuthError("initData user is missing");
  const user = JSON.parse(userRaw) as { id?: number; username?: string; photo_url?: unknown };
  if (typeof user.id !== "number") throw new AuthError("initData user.id is invalid");
  const startParam = params.get("start_param")?.trim() || null;
  const username = typeof user.username === "string" ? user.username.trim().replace(/^@/, "") : "";
  return { id: user.id, startParam, username: username || null, photoUrl: initPhotoUrl(user.photo_url) };
}

export function makeInitData(
  botToken: string,
  telegramUserId: number,
  firstName = "Ilia",
  startParam?: string,
  username?: string,
  photoUrl?: string,
): string {
  const user = JSON.stringify({
    id: telegramUserId,
    first_name: firstName,
    language_code: "ru",
    ...(username ? { username } : {}),
    ...(photoUrl ? { photo_url: photoUrl } : {}),
  });
  const authDate = Math.floor(Date.now() / 1000).toString();
  const fields: Record<string, string> = {
    auth_date: authDate,
    query_id: "dev-query",
    user,
  };
  if (startParam) fields.start_param = startParam;
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function extractInitData(headerAuth: string | undefined, initDataHeader: string | undefined): string | null {
  if (initDataHeader?.trim()) return initDataHeader.trim();
  if (!headerAuth) return null;
  const trimmed = headerAuth.trim();
  if (trimmed.toLowerCase().startsWith("tma ")) return trimmed.slice(4).trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) return trimmed.slice(7).trim();
  return null;
}

export async function resolveUser(
  headerAuth: string | undefined,
  initDataHeader: string | undefined,
): Promise<AppUser> {
  const initData = extractInitData(headerAuth, initDataHeader);
  let telegramUserId: number;
  let telegramUsername: string | null = null;
  let photoUrl: string | null = null;
  let startParam: string | null = null;
  let dev = false;

  if (initData && initData !== "dev") {
    if (isPlaceholderBotToken()) {
      throw new AuthError("BOT_TOKEN is not configured");
    }
    const parsed = validateInitData(initData, config.botToken);
    telegramUserId = parsed.id;
    telegramUsername = parsed.username;
    photoUrl = parsed.photoUrl;
    startParam = parsed.startParam;
  } else if (config.allowDevAuth) {
    telegramUserId = config.devTelegramUserId;
    dev = true;
  } else {
    throw new AuthError("Telegram initData is required");
  }

  const user = await upsertTelegramUser(telegramUserId);
  if (user.isNew) await claimReferralIfNew(user.id, startParam);
  else if (user.onboardingDone) await grantReferralOnOnboarding(user.id);
  await applyManualAccess(user.id, telegramUsername);
  const [subscribed, freeMediaId, referralUnlocks] = await Promise.all([
    hasActiveSubscription(user.id),
    freeMediaIdFor(user.id, user.language, user.freeMediaId),
    loadReferralUnlocks(user.id, user.language),
  ]);
  const appUser: AppUser = {
    id: user.id,
    telegramUserId: user.telegramUserId,
    telegramUsername,
    photoUrl,
    subscribed,
    freeMediaId,
    referralUnlocks,
    dev,
    onboardingDone: user.onboardingDone,
    language: user.language,
    languageChosen: user.languageChosen,
  };
  // Listed teachers have the same access as a subscription. This is not stored.
  if (!appUser.subscribed && (await isListedTeacher(appUser))) appUser.subscribed = true;
  return appUser;
}

export function runAsUser<T>(user: AppUser, fn: () => T): T {
  return enterLanguage(user.language || "en", fn);
}

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM subscriptions
      WHERE user_id = ${userId} AND expires_at > now()
    ) AS ok
  `;
  return Boolean(rows[0]?.ok);
}
