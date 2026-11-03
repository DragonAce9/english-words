import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { makeInitData } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { migrate } from "./migrate.js";
import { PET } from "./pet.js";
import { referralCodeFromStart, registerFromStart } from "./referrals.js";

const app = createApp();
const INVITER = 8_810_001;
const INVITED = 8_810_002;
const SELF = 8_810_003;
const EXISTING_INVITER = 8_810_004;
const EXISTING = 8_810_005;
const UNKNOWN = 8_810_006;
const SUPPORT_USER = 8_810_007;
const BOT_INVITER = 8_810_008;
const BOT_INVITED = 8_810_009;
const LEGACY_INVITER = 8_810_010;
const LEGACY_FRIEND = 8_810_011;
const SUB_INVITER = 8_810_012;
const SUB_FRIEND = 8_810_013;
const THEME_INVITER = 8_810_014;
const THEME_FRIEND = 8_810_015;
const THEME_FRIEND_2 = 8_810_016;
const MEDIA_INVITER = 8_810_017;
const MEDIA_FRIEND = 8_810_018;
const TELEGRAM_IDS = [
  INVITER,
  INVITED,
  SELF,
  EXISTING_INVITER,
  EXISTING,
  UNKNOWN,
  SUPPORT_USER,
  BOT_INVITER,
  BOT_INVITED,
  LEGACY_INVITER,
  LEGACY_FRIEND,
  SUB_INVITER,
  SUB_FRIEND,
  THEME_INVITER,
  THEME_FRIEND,
  THEME_FRIEND_2,
  MEDIA_INVITER,
  MEDIA_FRIEND,
];

const signingToken = config.botToken.includes("replace-me") ? "test-bot-token" : config.botToken;
let restoreToken: string | null = null;

function auth(telegramUserId: number, startParam?: string): Record<string, string> {
  return { Authorization: `tma ${makeInitData(signingToken, telegramUserId, "Ilia", startParam)}` };
}

interface PetBody {
  pet: {
    coins: number;
    coinsPerInvite: number;
    coinsPerKnownWord: number;
    knownCount: number;
  };
  referral: {
    code: string;
    inviteCount: number;
    inviteUrl: string;
    pendingInvites: number;
    completedInvites: number;
    unspentRewards: number;
    grantedRewards: number;
  };
  error?: string;
}

interface Choice {
  id: string;
  title: string;
  kind: "movie" | "series" | "theme";
}

interface RewardsBody extends PetBody["referral"] {
  picker: boolean;
  fullAccess: boolean;
  media: Choice[];
  themes: Choice[];
  error?: string;
  code?: string;
}

async function getPet(telegramUserId: number, startParam?: string) {
  const response = await app.request("/pet", { headers: auth(telegramUserId, startParam) });
  const body = (await response.json()) as PetBody;
  return { status: response.status, body };
}

async function knownRows(telegramUserIds: number[]): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM word_progress
    WHERE status = 'known'
      AND user_id IN (SELECT id FROM users WHERE telegram_user_id IN ${sql(telegramUserIds)})
  `;
  return Number(rows[0]?.n ?? 0);
}

async function finishOnboarding(telegramUserId: number) {
  const response = await app.request("/onboarding", { method: "POST", headers: auth(telegramUserId) });
  const body = (await response.json()) as { ok?: boolean; error?: string };
  return { status: response.status, body };
}

async function rewards(telegramUserId: number) {
  const response = await app.request("/referral/rewards", { headers: auth(telegramUserId) });
  const body = (await response.json()) as RewardsBody;
  return { status: response.status, body };
}

async function claim(telegramUserId: number, themeId: string) {
  const response = await app.request("/referral/rewards", {
    method: "POST",
    headers: { ...auth(telegramUserId), "Content-Type": "application/json" },
    body: JSON.stringify({ themeId }),
  });
  const body = (await response.json()) as { ok?: boolean; code?: string; error?: string; themeId?: string; kind?: string };
  return { status: response.status, body };
}

async function themeState(telegramUserId: number, themeId: string) {
  const response = await app.request("/themes", { headers: auth(telegramUserId) });
  const body = (await response.json()) as {
    themes: { id: string; locked: boolean; freePick?: boolean; referralPick?: boolean; claimable?: boolean }[];
  };
  const theme = body.themes.find((item) => item.id === themeId);
  if (!theme) throw new Error(`missing theme ${themeId}`);
  return theme;
}

async function rewardState(telegramUserId: number): Promise<string | null> {
  const rows = await sql<{ reward_state: string }[]>`
    SELECT reward_state FROM referrals
    WHERE invited_user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
  `;
  return rows[0]?.reward_state ?? null;
}

async function freeMedia(telegramUserId: number): Promise<string | null> {
  const rows = await sql<{ free_media_id: string | null }[]>`
    SELECT free_media_id FROM user_free_media
    WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId}) AND language = 'en'
  `;
  return rows[0]?.free_media_id ?? null;
}

async function unlockKeys(telegramUserId: number): Promise<string[]> {
  const rows = await sql<{ theme_key: string }[]>`
    SELECT theme_key FROM user_referral_unlocks
    WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId}) AND language = 'en'
    ORDER BY theme_key
  `;
  return rows.map((row) => row.theme_key);
}

async function referralRows(telegramUserId: number): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM referrals
    WHERE invited_user_id = (SELECT id FROM users WHERE telegram_user_id = ${telegramUserId})
  `;
  return Number(rows[0]?.n ?? 0);
}

async function cleanup() {
  await sql`
    DELETE FROM word_progress
    WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id IN ${sql(TELEGRAM_IDS)})
  `;
  await sql`
    DELETE FROM subscriptions
    WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id IN ${sql(TELEGRAM_IDS)})
  `;
  await sql`DELETE FROM users WHERE telegram_user_id IN ${sql(TELEGRAM_IDS)}`;
}

beforeAll(async () => {
  if (config.botToken.includes("replace-me")) {
    restoreToken = config.botToken;
    (config as { botToken: string }).botToken = signingToken;
  }
  await migrate();
  await dictionary.load();
  await cleanup();
}, 120_000);

afterAll(async () => {
  await cleanup();
  if (restoreToken) (config as { botToken: string }).botToken = restoreToken;
  await sql.end({ timeout: 5 });
});

describe("referral payload", () => {
  it("keeps the invite reward next to the other economy numbers", () => {
    expect(PET.coinsPerKnownWord).toBe(8);
    expect(PET.actionCost).toBe(10);
    expect(PET.coinsPerInvite).toBe(50);
  });

  it("does not treat support as a referral code", () => {
    expect(referralCodeFromStart("support")).toBeNull();
    expect(referralCodeFromStart("ref_")).toBeNull();
    expect(referralCodeFromStart("ref_ab")).toBeNull();
    expect(referralCodeFromStart("ref_abcd")).toBe("abcd");
  });
});

describe("referral rewards", () => {
  it("records the invite on open and grants one pick after the first session", async () => {
    const inviter = await getPet(INVITER);
    expect(inviter.status).toBe(200);
    expect(inviter.body.pet.coinsPerInvite).toBe(PET.coinsPerInvite);
    expect(inviter.body.referral.inviteCount).toBe(0);
    expect(inviter.body.referral.unspentRewards).toBe(0);
    expect(inviter.body.referral.code).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
    expect(inviter.body.referral.inviteUrl).toBe(
      `https://t.me/${config.botUsername}?start=ref_${inviter.body.referral.code}`,
    );
    const ids = await sql<{ id: string }[]>`SELECT id FROM users WHERE telegram_user_id = ${INVITER}`;
    expect(inviter.body.referral.code).not.toBe(ids[0].id);

    const again = await getPet(INVITER);
    expect(again.body.referral.code).toBe(inviter.body.referral.code);

    const code = inviter.body.referral.code;
    const invited = await getPet(INVITED, `ref_${code}`);
    expect(invited.status).toBe(200);
    expect(invited.body.pet.coins).toBe(PET.startingCoins);
    expect(invited.body.pet.knownCount).toBe(0);
    expect(invited.body.referral.unspentRewards).toBe(0);

    const opened = await getPet(INVITER);
    expect(opened.body.pet.coins).toBe(inviter.body.pet.coins);
    expect(opened.body.referral.inviteCount).toBe(1);
    expect(opened.body.referral.pendingInvites).toBe(1);
    expect(opened.body.referral.unspentRewards).toBe(0);
    expect(opened.body.referral.completedInvites).toBe(0);
    expect(await rewardState(INVITED)).toBe("pending");
    expect(await referralRows(INVITED)).toBe(1);
    expect(await knownRows([INVITER, INVITED])).toBe(0);

    const done = await finishOnboarding(INVITED);
    expect(done.status).toBe(200);
    const granted = await getPet(INVITER);
    expect(granted.body.pet.coins).toBe(inviter.body.pet.coins);
    expect(granted.body.referral.pendingInvites).toBe(0);
    expect(granted.body.referral.unspentRewards).toBe(1);
    expect(granted.body.referral.completedInvites).toBe(1);
    expect(granted.body.referral.grantedRewards).toBe(1);
    expect(await rewardState(INVITED)).toBe("ready");
    expect((await getPet(INVITED)).body.referral.unspentRewards).toBe(0);

    const againDone = await finishOnboarding(INVITED);
    expect(againDone.status).toBe(200);
    const repeat = await getPet(INVITED, `ref_${code}`);
    expect(repeat.status).toBe(200);
    await registerFromStart(INVITED, `ref_${code}`);
    const afterRepeat = await getPet(INVITER);
    expect(afterRepeat.body.pet.coins).toBe(inviter.body.pet.coins);
    expect(afterRepeat.body.referral.inviteCount).toBe(1);
    expect(afterRepeat.body.referral.unspentRewards).toBe(1);
    expect(await referralRows(INVITED)).toBe(1);
  });

  it("does not credit a self-ref", async () => {
    const user = await getPet(SELF);
    expect(user.status).toBe(200);
    const again = await getPet(SELF, `ref_${user.body.referral.code}`);
    expect(again.status).toBe(200);
    expect(again.body.pet.coins).toBe(user.body.pet.coins);
    expect(again.body.referral.inviteCount).toBe(0);
    await registerFromStart(SELF, `ref_${user.body.referral.code}`);
    const afterBot = await getPet(SELF);
    expect(afterBot.body.pet.coins).toBe(user.body.pet.coins);
    expect(await referralRows(SELF)).toBe(0);
  });

  it("does not credit when an existing user opens a ref link", async () => {
    const inviter = await getPet(EXISTING_INVITER);
    const existing = await getPet(EXISTING);
    expect(existing.status).toBe(200);
    const coins = inviter.body.pet.coins;

    const viaWeb = await getPet(EXISTING, `ref_${inviter.body.referral.code}`);
    expect(viaWeb.status).toBe(200);
    await registerFromStart(EXISTING, `ref_${inviter.body.referral.code}`);

    const after = await getPet(EXISTING_INVITER);
    expect(after.body.pet.coins).toBe(coins);
    expect(after.body.referral.inviteCount).toBe(0);
    expect(await referralRows(EXISTING)).toBe(0);
    expect(viaWeb.body.pet.coins).toBe(PET.startingCoins);
  });

  it("does not crash signup on an unknown code or the support payload", async () => {
    const unknown = await getPet(UNKNOWN, "ref_not_a_real_code");
    expect(unknown.status).toBe(200);
    expect(unknown.body.pet.coins).toBe(PET.startingCoins);
    expect(unknown.body.referral.code).not.toBe("not_a_real_code");
    expect(await referralRows(UNKNOWN)).toBe(0);

    const support = await getPet(SUPPORT_USER, "support");
    expect(support.status).toBe(200);
    expect(support.body.pet.coins).toBe(PET.startingCoins);
    expect(await referralRows(SUPPORT_USER)).toBe(0);
    await registerFromStart(SUPPORT_USER, "support");
    expect(await referralRows(SUPPORT_USER)).toBe(0);
  });

  it("shares one referral record between the bot and the Mini App", async () => {
    const inviter = await getPet(BOT_INVITER);
    const before = inviter.body.pet.coins;
    await registerFromStart(BOT_INVITED, `ref_${inviter.body.referral.code}`);
    const opened = await getPet(BOT_INVITER);
    expect(opened.body.pet.coins).toBe(before);
    expect(opened.body.referral.inviteCount).toBe(1);
    expect(opened.body.referral.unspentRewards).toBe(0);
    expect(await rewardState(BOT_INVITED)).toBe("pending");

    const web = await getPet(BOT_INVITED, `ref_${inviter.body.referral.code}`);
    expect(web.status).toBe(200);
    expect(web.body.pet.coins).toBe(PET.startingCoins);
    const done = await finishOnboarding(BOT_INVITED);
    expect(done.status).toBe(200);
    const after = await getPet(BOT_INVITER);
    expect(after.body.pet.coins).toBe(before);
    expect(after.body.referral.inviteCount).toBe(1);
    expect(after.body.referral.unspentRewards).toBe(1);
    expect(await referralRows(BOT_INVITED)).toBe(1);
    expect(await knownRows([BOT_INVITER, BOT_INVITED])).toBe(0);
  });

  it("does not turn an old coin invite into a collection pick", async () => {
    const inviter = await getPet(LEGACY_INVITER);
    const coins = inviter.body.pet.coins;
    await getPet(LEGACY_FRIEND, `ref_${inviter.body.referral.code}`);
    await sql`
      UPDATE referrals
      SET reward_state = 'legacy'
      WHERE invited_user_id = (SELECT id FROM users WHERE telegram_user_id = ${LEGACY_FRIEND})
    `;
    const done = await finishOnboarding(LEGACY_FRIEND);
    expect(done.status).toBe(200);
    const after = await getPet(LEGACY_INVITER);
    expect(after.body.pet.coins).toBe(coins);
    expect(after.body.referral.unspentRewards).toBe(0);
    expect(after.body.referral.completedInvites).toBe(0);
    expect(await rewardState(LEGACY_FRIEND)).toBe("legacy");
  });

  it("saves the invite without a pick when the inviter is already subscribed", async () => {
    const inviter = await getPet(SUB_INVITER);
    const coins = inviter.body.pet.coins;
    await getPet(SUB_FRIEND, `ref_${inviter.body.referral.code}`);
    await sql`
      INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at)
      SELECT id, 8810012, 'monthly', 'regular', now() + interval '30 days'
      FROM users WHERE telegram_user_id = ${SUB_INVITER}
    `;
    const done = await finishOnboarding(SUB_FRIEND);
    expect(done.status).toBe(200);
    const saved = await getPet(SUB_INVITER);
    expect(saved.body.pet.coins).toBe(coins);
    expect(saved.body.referral.unspentRewards).toBe(0);
    expect(saved.body.referral.completedInvites).toBe(1);
    expect(saved.body.referral.grantedRewards).toBe(0);
    expect(await rewardState(SUB_FRIEND)).toBe("saved");

    const denied = await claim(SUB_INVITER, "health");
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe("subscription_covers");
    expect(await unlockKeys(SUB_INVITER)).toEqual([]);

    await sql`
      DELETE FROM subscriptions
      WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${SUB_INVITER})
    `;
    const after = await getPet(SUB_INVITER);
    expect(after.body.referral.unspentRewards).toBe(0);
    expect((await themeState(SUB_INVITER, "health")).locked).toBe(true);
    const stillDenied = await claim(SUB_INVITER, "health");
    expect(stillDenied.status).toBe(409);
    expect(stillDenied.body.code).toBe("no_reward");
  });

  it("unlocks one locked theme and leaves the free film slot alone", async () => {
    const inviter = await getPet(THEME_INVITER);
    const coins = inviter.body.pet.coins;
    await getPet(THEME_FRIEND, `ref_${inviter.body.referral.code}`);
    await finishOnboarding(THEME_FRIEND);

    const list = await rewards(THEME_INVITER);
    expect(list.status).toBe(200);
    expect(list.body.picker).toBe(true);
    expect(list.body.themes.some((item) => item.id === "health" && item.kind === "theme")).toBe(true);
    expect(list.body.themes.some((item) => item.id === "travel")).toBe(false);
    expect(list.body.media.some((item) => item.id === "shrek" && item.kind === "movie")).toBe(true);
    expect(list.body.media.some((item) => item.id === "show:lost" && item.kind === "series")).toBe(true);

    const freeTheme = await claim(THEME_INVITER, "travel");
    expect(freeTheme.status).toBe(400);
    expect(freeTheme.body.code).toBe("not_eligible");
    expect((await getPet(THEME_INVITER)).body.referral.unspentRewards).toBe(1);

    await sql`
      INSERT INTO subscriptions (user_id, tribute_subscription_id, period, type, expires_at)
      SELECT id, 8810014, 'monthly', 'regular', now() + interval '30 days'
      FROM users WHERE telegram_user_id = ${THEME_INVITER}
    `;
    const covered = await claim(THEME_INVITER, "health");
    expect(covered.status).toBe(409);
    expect(covered.body.code).toBe("subscription_covers");
    expect((await getPet(THEME_INVITER)).body.referral.unspentRewards).toBe(1);
    expect(await unlockKeys(THEME_INVITER)).toEqual([]);
    await sql`
      DELETE FROM subscriptions
      WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = ${THEME_INVITER})
    `;

    const otherId = list.body.themes.find((item) => item.id !== "health")?.id;
    expect(otherId).toBeTruthy();
    const opened = await claim(THEME_INVITER, "health");
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ themeId: "health", kind: "theme" });
    expect((await getPet(THEME_INVITER)).body.pet.coins).toBe(coins);
    expect((await getPet(THEME_INVITER)).body.referral.unspentRewards).toBe(0);
    expect(await freeMedia(THEME_INVITER)).toBeNull();
    expect(await unlockKeys(THEME_INVITER)).toEqual(["health"]);
    expect(await themeState(THEME_INVITER, "health")).toMatchObject({ locked: false, referralPick: true });
    expect((await themeState(THEME_INVITER, "travel")).locked).toBe(false);
    expect((await themeState(THEME_INVITER, otherId!)).locked).toBe(true);
    expect((await app.request("/themes/health/words", { headers: auth(THEME_INVITER) })).status).toBe(200);
    expect((await app.request(`/themes/${otherId}/words`, { headers: auth(THEME_INVITER) })).status).toBe(403);

    await getPet(THEME_FRIEND_2, `ref_${inviter.body.referral.code}`);
    await finishOnboarding(THEME_FRIEND_2);
    expect((await getPet(THEME_INVITER)).body.referral.unspentRewards).toBe(1);
    const again = await claim(THEME_INVITER, "health");
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("not_eligible");
    expect((await getPet(THEME_INVITER)).body.referral.unspentRewards).toBe(1);
    const second = await claim(THEME_INVITER, otherId!);
    expect(second.status).toBe(200);
    expect((await getPet(THEME_INVITER)).body.referral.unspentRewards).toBe(0);
    expect((await themeState(THEME_INVITER, otherId!)).locked).toBe(false);
    expect(await freeMedia(THEME_INVITER)).toBeNull();
  }, 40_000);

  it("opens a series without spending the free film", async () => {
    const inviter = await getPet(MEDIA_INVITER);
    const claimedFilm = await app.request("/sessions", {
      method: "POST",
      headers: { ...auth(MEDIA_INVITER), "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "shrek", mode: "learn" }),
    });
    expect(claimedFilm.status).toBe(200);
    expect(await freeMedia(MEDIA_INVITER)).toBe("shrek");

    await getPet(MEDIA_FRIEND, `ref_${inviter.body.referral.code}`);
    await finishOnboarding(MEDIA_FRIEND);
    const list = await rewards(MEDIA_INVITER);
    expect(list.body.media.some((item) => item.id === "shrek")).toBe(false);
    expect(list.body.media.some((item) => item.id === "show:lost")).toBe(true);
    const otherMovie = list.body.media.find((item) => item.kind === "movie")?.id;
    expect(otherMovie).toBeTruthy();

    const filmAgain = await claim(MEDIA_INVITER, "shrek");
    expect(filmAgain.status).toBe(400);
    expect(filmAgain.body.code).toBe("not_eligible");
    expect((await getPet(MEDIA_INVITER)).body.referral.unspentRewards).toBe(1);

    const series = await claim(MEDIA_INVITER, "show:lost");
    expect(series.status).toBe(200);
    expect(series.body.kind).toBe("series");
    expect(await freeMedia(MEDIA_INVITER)).toBe("shrek");
    expect(await themeState(MEDIA_INVITER, "lost-s01e01")).toMatchObject({
      locked: false,
      referralPick: true,
      freePick: false,
    });
    expect(await themeState(MEDIA_INVITER, "shrek")).toMatchObject({
      locked: false,
      freePick: true,
      referralPick: false,
    });
    expect((await themeState(MEDIA_INVITER, otherMovie!)).locked).toBe(true);

    const episode = await app.request("/sessions", {
      method: "POST",
      headers: { ...auth(MEDIA_INVITER), "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "lost-s01e01", mode: "learn" }),
    });
    expect(episode.status).toBe(200);
    expect(await freeMedia(MEDIA_INVITER)).toBe("shrek");
    expect((await getPet(MEDIA_INVITER)).body.referral.unspentRewards).toBe(0);
  }, 40_000);
});
