import { randomBytes } from "node:crypto";
import { hasReferralUnlock, isMediaTheme, mediaPickKey } from "./access.js";
import { invalidateThemeCatalog } from "./catalogCache.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { HttpError } from "./httpError.js";
import { isListedTeacher } from "./teachers.js";
import type { AppUser } from "./types.js";

const REF_PREFIX = "ref_";
const CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

export interface ReferralSummary {
  code: string;
  inviteCount: number;
  inviteUrl: string;
  pendingInvites: number;
  completedInvites: number;
  unspentRewards: number;
  grantedRewards: number;
}

export interface ReferralChoice {
  id: string;
  title: string;
  kind: "movie" | "series" | "theme";
  year: number | null;
}

export interface ReferralRewards extends ReferralSummary {
  picker: boolean;
  fullAccess: boolean;
  media: ReferralChoice[];
  themes: ReferralChoice[];
}

interface UserRow {
  id: string;
  telegram_user_id: string;
  onboarding_done_at: Date | null;
  free_media_id: string | null;
  referral_code: string | null;
  language: string | null;
  language_chosen: boolean | null;
}

export interface UpsertedUser {
  id: string;
  telegramUserId: number;
  freeMediaId: string | null;
  onboardingDone: boolean;
  isNew: boolean;
  referralCode: string;
  language: string;
  languageChosen: boolean;
}

export function referralCodeFromStart(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const trimmed = payload.trim();
  if (!trimmed.startsWith(REF_PREFIX)) return null;
  const code = trimmed.slice(REF_PREFIX.length);
  if (!CODE_PATTERN.test(code)) return null;
  return code;
}

export function buildInviteUrl(code: string): string {
  const username = config.botUsername || "YOUR_BOT_USERNAME";
  return `https://t.me/${username}?start=ref_${encodeURIComponent(code)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export function createReferralCode(): string {
  return randomBytes(9).toString("base64url");
}

async function ensureReferralCode(userId: string, current: string | null): Promise<string> {
  if (current) return current;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createReferralCode();
    try {
      const updated = await sql<{ referral_code: string }[]>`
        UPDATE users
        SET referral_code = ${code}
        WHERE id = ${userId}::bigint AND referral_code IS NULL
        RETURNING referral_code
      `;
      if (updated[0]?.referral_code) return updated[0].referral_code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const again = await sql<{ referral_code: string | null }[]>`
      SELECT referral_code FROM users WHERE id = ${userId}::bigint
    `;
    if (again[0]?.referral_code) return again[0].referral_code;
  }
  throw new Error("referral code was not assigned");
}

export async function upsertTelegramUser(telegramUserId: number): Promise<UpsertedUser> {
  const inserted = await sql<UserRow[]>`
    INSERT INTO users (telegram_user_id)
    VALUES (${telegramUserId})
    ON CONFLICT (telegram_user_id) DO NOTHING
    RETURNING id, telegram_user_id, onboarding_done_at, free_media_id, referral_code, language, language_chosen
  `;
  const row =
    inserted[0] ??
    (
      await sql<UserRow[]>`
        SELECT id, telegram_user_id, onboarding_done_at, free_media_id, referral_code, language, language_chosen
        FROM users
        WHERE telegram_user_id = ${telegramUserId}
      `
    )[0];
  if (!row) throw new Error("user row missing after upsert");
  const id = String(row.id);
  const referralCode = await ensureReferralCode(id, row.referral_code);
  return {
    id,
    telegramUserId: Number(row.telegram_user_id),
    freeMediaId: row.free_media_id ?? null,
    onboardingDone: Boolean(row.onboarding_done_at),
    isNew: Boolean(inserted[0]),
    referralCode,
    language: row.language || "en",
    languageChosen: Boolean(row.language_chosen),
  };
}

/** Remember who invited this new user. The pick is granted only after the first session. */
export async function claimReferralIfNew(
  invitedUserId: string,
  startPayload: string | null | undefined,
): Promise<boolean> {
  const code = referralCodeFromStart(startPayload);
  if (!code) return false;
  try {
    return await sql.begin(async (tx) => {
      const inviters = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE referral_code = ${code} LIMIT 1
      `;
      const inviterId = inviters[0] ? String(inviters[0].id) : null;
      if (!inviterId || inviterId === invitedUserId) return false;

      const inserted = await tx<{ invited_user_id: string }[]>`
        INSERT INTO referrals (invited_user_id, inviter_user_id)
        VALUES (${invitedUserId}::bigint, ${inviterId}::bigint)
        ON CONFLICT (invited_user_id) DO NOTHING
        RETURNING invited_user_id
      `;
      return Boolean(inserted[0]);
    });
  } catch (error) {
    console.error("referral: claim failed", error);
    return false;
  }
}

async function inviterHasFullAccess(inviterId: string): Promise<boolean> {
  const subscribed = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM subscriptions
      WHERE user_id = ${inviterId}::bigint AND expires_at > now()
    ) AS ok
  `;
  if (subscribed[0]?.ok) return true;
  const rows = await sql<{ telegram_user_id: string; language: string | null }[]>`
    SELECT telegram_user_id, language FROM users WHERE id = ${inviterId}::bigint
  `;
  const row = rows[0];
  if (!row) return false;
  return isListedTeacher({
    telegramUserId: Number(row.telegram_user_id),
    telegramUsername: null,
    language: row.language || "en",
  });
}

/** One pick for the inviter when the invited user finishes the first session. Idempotent. */
export async function grantReferralOnOnboarding(invitedUserId: string): Promise<void> {
  const pending = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM referrals
    WHERE invited_user_id = ${invitedUserId}::bigint AND reward_state = 'pending'
    LIMIT 1
  `;
  if (!pending[0]) return;
  await sql.begin(async (tx) => {
    const rows = await tx<{ inviter_user_id: string }[]>`
      SELECT inviter_user_id
      FROM referrals
      WHERE invited_user_id = ${invitedUserId}::bigint AND reward_state = 'pending'
      FOR UPDATE
    `;
    const inviterId = rows[0] ? String(rows[0].inviter_user_id) : null;
    if (!inviterId) return;
    const done = await tx<{ onboarding_done_at: Date | null }[]>`
      SELECT onboarding_done_at FROM users WHERE id = ${invitedUserId}::bigint
    `;
    if (!done[0]?.onboarding_done_at) return;
    const covered = await inviterHasFullAccess(inviterId);
    await tx`
      UPDATE referrals
      SET reward_state = ${covered ? "saved" : "ready"}
      WHERE invited_user_id = ${invitedUserId}::bigint AND reward_state = 'pending'
    `;
  });
}

export async function loadReferralUnlocks(userId: string, language: string): Promise<string[]> {
  const rows = await sql<{ theme_key: string }[]>`
    SELECT theme_key
    FROM user_referral_unlocks
    WHERE user_id = ${userId}::bigint AND language = ${language}
  `;
  return rows.map((row) => row.theme_key);
}

function byTitle(a: ReferralChoice, b: ReferralChoice): number {
  return a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id);
}

/** Paid collections the inviter does not already have. Does not include the free quota. */
export function eligibleReferralChoices(user: AppUser): ReferralChoice[] {
  const media = new Map<string, ReferralChoice>();
  const themes: ReferralChoice[] = [];
  for (const theme of dictionary.listThemes()) {
    if (theme.kind === "text") continue;
    if (isMediaTheme(theme)) {
      const key = mediaPickKey(theme);
      if (user.freeMediaId === key || hasReferralUnlock(user, key) || media.has(key)) continue;
      const series = theme.kind === "episode" && Boolean(theme.showId);
      media.set(key, {
        id: key,
        title: series ? theme.showTitle?.trim() || theme.title : theme.title,
        kind: series ? "series" : "movie",
        year: theme.year ?? null,
      });
      continue;
    }
    if (!theme.paid || hasReferralUnlock(user, theme.id)) continue;
    themes.push({ id: theme.id, title: theme.title, kind: "theme", year: null });
  }
  return [...media.values()].sort(byTitle).concat(themes.sort(byTitle));
}

export async function registerFromStart(telegramUserId: number, payload: string | undefined): Promise<void> {
  const user = await upsertTelegramUser(telegramUserId);
  if (!user.isNew) return;
  await claimReferralIfNew(user.id, payload);
}

export async function loadReferralSummary(userId: string): Promise<ReferralSummary> {
  const rows = await sql<{ referral_code: string | null }[]>`
    SELECT referral_code FROM users WHERE id = ${userId}::bigint
  `;
  const code = await ensureReferralCode(userId, rows[0]?.referral_code ?? null);
  const counts = await sql<{ invite_count: number; pending: number; completed: number; unspent: number; granted: number }[]>`
    SELECT
      count(*)::int AS invite_count,
      count(*) FILTER (WHERE reward_state = 'pending')::int AS pending,
      count(*) FILTER (WHERE reward_state IN ('ready', 'claimed', 'saved'))::int AS completed,
      count(*) FILTER (WHERE reward_state = 'ready')::int AS unspent,
      count(*) FILTER (WHERE reward_state IN ('ready', 'claimed'))::int AS granted
    FROM referrals
    WHERE inviter_user_id = ${userId}::bigint
  `;
  const row = counts[0];
  return {
    code,
    inviteCount: Number(row?.invite_count ?? 0),
    inviteUrl: buildInviteUrl(code),
    pendingInvites: Number(row?.pending ?? 0),
    completedInvites: Number(row?.completed ?? 0),
    unspentRewards: Number(row?.unspent ?? 0),
    grantedRewards: Number(row?.granted ?? 0),
  };
}

export async function loadReferralRewards(user: AppUser): Promise<ReferralRewards> {
  const summary = await loadReferralSummary(user.id);
  const picker = !user.subscribed && summary.unspentRewards > 0;
  const choices = picker ? eligibleReferralChoices(user) : [];
  return {
    ...summary,
    picker,
    fullAccess: user.subscribed,
    media: choices.filter((item) => item.kind !== "theme"),
    themes: choices.filter((item) => item.kind === "theme"),
  };
}

export async function claimReferralReward(
  user: AppUser,
  rawId: string,
): Promise<{ themeId: string; kind: ReferralChoice["kind"]; title: string }> {
  const themeId = rawId.trim();
  if (!themeId || themeId.length > 80) {
    throw new HttpError("Нужно выбрать коллекцию", 400, "theme_required");
  }
  if (user.subscribed) {
    throw new HttpError("Полный доступ уже включает все коллекции", 409, "subscription_covers");
  }

  try {
    const claimed = await sql.begin(async (tx) => {
      const ready = await tx<{ invited_user_id: string }[]>`
        SELECT invited_user_id
        FROM referrals
        WHERE inviter_user_id = ${user.id}::bigint AND reward_state = 'ready'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE
      `;
      if (!ready[0]) throw new HttpError("Нет неиспользованного приглашения", 409, "no_reward");

      const language = user.language || "en";
      const freeRows = await tx<{ free_media_id: string }[]>`
        SELECT free_media_id FROM user_free_media
        WHERE user_id = ${user.id}::bigint AND language = ${language}
      `;
      const legacyRows =
        language === "en"
          ? await tx<{ free_media_id: string | null }[]>`
              SELECT free_media_id FROM users WHERE id = ${user.id}::bigint
            `
          : [];
      const unlockRows = await tx<{ theme_key: string }[]>`
        SELECT theme_key FROM user_referral_unlocks
        WHERE user_id = ${user.id}::bigint AND language = ${language}
      `;
      const freeMediaId = freeRows[0]?.free_media_id ?? (language === "en" ? legacyRows[0]?.free_media_id ?? null : null);
      const snapshot: AppUser = {
        ...user,
        subscribed: false,
        freeMediaId,
        referralUnlocks: unlockRows.map((row) => row.theme_key),
      };
      const choice = eligibleReferralChoices(snapshot).find((item) => item.id === themeId);
      if (!choice) throw new HttpError("Эту коллекцию нельзя открыть приглашением", 400, "not_eligible");

      await tx`
        INSERT INTO user_referral_unlocks (user_id, language, theme_key)
        VALUES (${user.id}::bigint, ${language}, ${choice.id})
      `;
      await tx`
        UPDATE referrals
        SET reward_state = 'claimed', claimed_key = ${choice.id}, claimed_at = now()
        WHERE invited_user_id = ${ready[0].invited_user_id}::bigint AND reward_state = 'ready'
      `;
      return choice;
    });
    user.referralUnlocks = [...(user.referralUnlocks ?? []), claimed.id];
    invalidateThemeCatalog(user.id);
    return { themeId: claimed.id, kind: claimed.kind, title: claimed.title };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError("Эту коллекцию нельзя открыть приглашением", 400, "not_eligible");
    }
    throw error;
  }
}
