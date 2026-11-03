import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import type { AppUser, DictTheme } from "./types.js";

export const FREE_THEME_IDS = [
  "numbers",
  "colors",
  "family",
  "time",
  "daily",
  "body",
  "clothes",
  "food",
  "home",
  "travel",
] as const;

const FREE_THEME_SET = new Set<string>(FREE_THEME_IDS);

export const FREE_TEXT_LIMIT = 1;
export const FREE_TEXT_CHARS = 2000;
export const PAID_TEXT_LIMIT = 8;
export const PAID_TEXT_CHARS = 20_000;
/** Paid users may add this many new texts per rolling window. */
export const PAID_TEXTS_PER_MONTH = 2;
export const TEXT_WINDOW_DAYS = 30;

export interface TextQuotaInfo {
  maxTexts: number;
  maxChars: number;
  used: number;
  /** Rolling-window limit for new texts; null when the plan has no monthly limit (free tier uses the slot). */
  monthlyLimit: number | null;
  monthlyUsed: number;
  windowDays: number;
  /** When the oldest counted upload leaves the window, i.e. when the next slot frees up. */
  nextAt: string | null;
}

export function isFreeCatalogTheme(themeId: string): boolean {
  return FREE_THEME_SET.has(themeId);
}

export function isMediaTheme(theme: { kind?: string | null }): boolean {
  return theme.kind === "movie" || theme.kind === "episode";
}

export function mediaPickKey(theme: Pick<DictTheme, "id" | "kind" | "showId">): string {
  if (theme.kind === "episode" && theme.showId) return `show:${theme.showId}`;
  return theme.id;
}

const UNLIMITED_MONTHLY_TEXT_USERS = new Set(["your_telegram_username"]);
const UNLIMITED_MONTHLY_TEXT_TELEGRAM_IDS = new Set([1000000002]);

function hasUnlimitedMonthlyTexts(user: AppUser): boolean {
  if (UNLIMITED_MONTHLY_TEXT_TELEGRAM_IDS.has(user.telegramUserId)) return true;
  const username = user.telegramUsername?.trim().replace(/^@/, "").toLowerCase() ?? "";
  return Boolean(username && UNLIMITED_MONTHLY_TEXT_USERS.has(username));
}

export async function textQuota(user: AppUser, used: number): Promise<TextQuotaInfo> {
  const base = {
    maxTexts: user.subscribed ? PAID_TEXT_LIMIT : FREE_TEXT_LIMIT,
    maxChars: user.subscribed ? PAID_TEXT_CHARS : FREE_TEXT_CHARS,
    used,
    windowDays: TEXT_WINDOW_DAYS,
  };
  if (!user.subscribed || hasUnlimitedMonthlyTexts(user)) {
    return { ...base, monthlyLimit: null, monthlyUsed: 0, nextAt: null };
  }
  const rows = await sql<{ created_at: Date }[]>`
    SELECT created_at
    FROM user_text_uploads
    WHERE user_id = ${user.id}::bigint
      AND created_at > now() - make_interval(days => ${TEXT_WINDOW_DAYS})
    ORDER BY created_at ASC
  `;
  const monthlyUsed = rows.length;
  const oldest = rows[0]?.created_at ?? null;
  const nextAt =
    monthlyUsed >= PAID_TEXTS_PER_MONTH && oldest
      ? new Date(oldest.getTime() + TEXT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null;
  return { ...base, monthlyLimit: PAID_TEXTS_PER_MONTH, monthlyUsed, nextAt };
}

export async function recordTextUpload(userId: string, textId: string): Promise<void> {
  await sql`
    INSERT INTO user_text_uploads (user_id, text_id)
    VALUES (${userId}::bigint, ${textId}::bigint)
  `;
}

export function formatRuDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function hasReferralUnlock(user: Pick<AppUser, "referralUnlocks">, key: string): boolean {
  return (user.referralUnlocks ?? []).includes(key);
}

export function themeLocked(theme: DictTheme, user: AppUser): boolean {
  if (user.subscribed) return false;
  if (theme.kind === "text") return false;
  if (isMediaTheme(theme)) {
    const key = mediaPickKey(theme);
    if (hasReferralUnlock(user, key)) return false;
    if (!user.freeMediaId) return false;
    return user.freeMediaId !== key;
  }
  if (hasReferralUnlock(user, theme.id)) return false;
  return theme.paid;
}

export function themeClaimable(theme: DictTheme, user: AppUser): boolean {
  if (user.subscribed || !isMediaTheme(theme) || user.freeMediaId) return false;
  return !hasReferralUnlock(user, mediaPickKey(theme));
}

export function themeFreePick(theme: DictTheme, user: AppUser): boolean {
  return !user.subscribed && isMediaTheme(theme) && user.freeMediaId === mediaPickKey(theme);
}

/** An extra collection from a completed invite. Separate from the one free film. */
export function themeReferralPick(theme: DictTheme, user: AppUser): boolean {
  if (user.subscribed) return false;
  const key = isMediaTheme(theme) ? mediaPickKey(theme) : theme.id;
  return hasReferralUnlock(user, key);
}

export function canLearnTheme(theme: DictTheme, user: AppUser): boolean {
  if (user.subscribed) return true;
  if (theme.kind === "text") return true;
  if (isMediaTheme(theme)) {
    const key = mediaPickKey(theme);
    if (hasReferralUnlock(user, key)) return true;
    return user.freeMediaId === key;
  }
  if (hasReferralUnlock(user, theme.id)) return true;
  if (!theme.paid) return true;
  return false;
}

export async function freeMediaIdFor(userId: string, language: string, legacy: string | null): Promise<string | null> {
  const rows = await sql<{ free_media_id: string }[]>`
    SELECT free_media_id FROM user_free_media
    WHERE user_id = ${userId}::bigint AND language = ${language}
  `;
  if (rows[0]?.free_media_id) return rows[0].free_media_id;
  if (language === "en") return legacy;
  return null;
}

export async function claimFreeMedia(user: AppUser, theme: DictTheme): Promise<boolean> {
  if (user.subscribed) return true;
  if (!isMediaTheme(theme)) return !theme.paid || hasReferralUnlock(user, theme.id);
  const key = mediaPickKey(theme);
  if (hasReferralUnlock(user, key)) return true;
  if (user.freeMediaId === key) return true;
  if (user.freeMediaId) return false;

  const language = user.language || activeLanguage();
  const rows = await sql<{ free_media_id: string }[]>`
    INSERT INTO user_free_media (user_id, language, free_media_id)
    VALUES (${user.id}::bigint, ${language}, ${key})
    ON CONFLICT (user_id, language) DO NOTHING
    RETURNING free_media_id
  `;
  if (language === "en") {
    await sql`
      UPDATE users
      SET free_media_id = ${key}
      WHERE id = ${user.id}::bigint AND free_media_id IS NULL
    `;
  }
  if (rows[0]?.free_media_id === key) {
    user.freeMediaId = key;
    return true;
  }

  user.freeMediaId = await freeMediaIdFor(user.id, language, language === "en" ? user.freeMediaId : null);
  return user.freeMediaId === key;
}
