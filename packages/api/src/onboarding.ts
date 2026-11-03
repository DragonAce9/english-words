import { sql } from "./db.js";
import { HttpError } from "./httpError.js";
import { grantReferralOnOnboarding } from "./referrals.js";
import type { AppUser } from "./types.js";

export const GUIDE_TRIES = ["moti", "study", "words", "path"] as const;
export type GuideTry = (typeof GUIDE_TRIES)[number];

function orderedTries(values: readonly string[] | null | undefined): GuideTry[] {
  const have = new Set(values ?? []);
  return GUIDE_TRIES.filter((id) => have.has(id));
}

export async function markOnboardingDone(user: AppUser): Promise<{ ok: true; onboardingDone: true }> {
  await sql`
    UPDATE users
    SET onboarding_done_at = COALESCE(onboarding_done_at, now())
    WHERE id = ${user.id}::bigint
  `;
  await grantReferralOnOnboarding(user.id);
  return { ok: true, onboardingDone: true };
}

export async function loadGuideTries(userId: string): Promise<GuideTry[]> {
  const rows = await sql<{ guide_tries: string[] | null }[]>`
    SELECT guide_tries FROM users WHERE id = ${userId}::bigint
  `;
  return orderedTries(rows[0]?.guide_tries);
}

export async function markGuideTry(user: AppUser, raw: string): Promise<{ tries: GuideTry[] }> {
  if (!(GUIDE_TRIES as readonly string[]).includes(raw)) {
    throw new HttpError("guide step is invalid", 400, "invalid_guide");
  }
  const rows = await sql<{ guide_tries: string[] | null }[]>`
    UPDATE users
    SET guide_tries = (
      SELECT COALESCE(array_agg(DISTINCT item), ARRAY[]::text[])
      FROM unnest(COALESCE(guide_tries, '{}'::text[]) || ${[raw]}::text[]) AS item
    )
    WHERE id = ${user.id}::bigint
    RETURNING guide_tries
  `;
  return { tries: orderedTries(rows[0]?.guide_tries) };
}
