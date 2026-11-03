import type postgres from "postgres";
import { activeLanguage } from "./catalogContext.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { HttpError } from "./session.js";
import type { AppUser, PetAction, PetSnapshot, PetStatus } from "./types.js";

/** Economy knobs — see README «Тамагочи». Starter = 2 care actions + 1h upkeep. */
export const PET = {
  coinsPerKnownWord: 8,
  actionCost: 10,
  /** Kept on the pet snapshot for older clients. Invites no longer pay coins. */
  coinsPerInvite: 50,
  actionGain: 24,
  tickIntervalMs: 60 * 60 * 1000,
  coinsPerTick: 2,
  decayPerTick: 4,
  brokeDecay: 8,
  /** Same threshold as MOTI_LOW_STAT on the client. Suffering only while a bar is below this. */
  lowStat: 30,
  rescueRestore: 45,
  maxCatchupTicks: 24 * 40,
  /** 2 × actionCost + coinsPerTick so a brand-new user can press feed + play once. */
  startingCoins: 22,
  /**
   * Above lowStat, below the happy line. A new Moti looks fine;
   * feed and play still raise the bars, and the sad pose waits until a bar actually drops.
   */
  startingHunger: 60,
  startingMood: 60,
} as const;

const ACTIONS: Record<PetAction, "hunger" | "mood"> = {
  feed: "hunger",
  play: "mood",
};

export interface PetState {
  coins: number;
  hunger: number;
  mood: number;
  home: number;
  study: number;
  status: PetStatus;
  lastTickAt: Date;
  sufferingStartedAt: Date | null;
  cryoAt: Date | null;
  graduatedAt: Date | null;
}

type Queryable = postgres.TransactionSql;

interface PetRow {
  coins: number;
  hunger: number;
  mood: number;
  home: number;
  study: number;
  status: PetStatus;
  last_tick_at: Date;
  suffering_started_at: Date | null;
  cryo_at: Date | null;
  graduated_at: Date | null;
}

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Pose and cryo-clock follow the bars, not an empty wallet. */
export function petStatsAreLow(pet: Pick<PetState, "hunger" | "mood">): boolean {
  return pet.hunger < PET.lowStat || pet.mood < PET.lowStat;
}

export function sufferMs(): number {
  return Math.max(0, config.petSufferHours) * 60 * 60 * 1000;
}

export function applyTick(pet: PetState, now: Date, sufferThresholdMs = sufferMs()): PetState {
  if (pet.status === "graduated") return pet;

  const next: PetState = { ...pet };

  if (pet.status !== "cryo") {
    const elapsed = now.getTime() - pet.lastTickAt.getTime();
    const ticks = Math.max(0, Math.min(Math.floor(elapsed / PET.tickIntervalMs), PET.maxCatchupTicks));
    for (let i = 0; i < ticks; i += 1) {
      if (next.coins >= PET.coinsPerTick) {
        next.coins -= PET.coinsPerTick;
        next.hunger = clampStat(next.hunger - PET.decayPerTick);
        next.mood = clampStat(next.mood - PET.decayPerTick);
        // home/study kept in DB for legacy rows but no longer decay or surface in UI
      } else {
        next.coins = 0;
        next.hunger = clampStat(next.hunger - PET.brokeDecay);
        next.mood = clampStat(next.mood - PET.brokeDecay);
        if (next.status === "alive" && petStatsAreLow(next)) {
          next.status = "suffering";
          next.sufferingStartedAt = new Date(pet.lastTickAt.getTime() + (i + 1) * PET.tickIntervalMs);
        }
      }
    }
    if (ticks > 0) {
      next.lastTickAt = new Date(pet.lastTickAt.getTime() + ticks * PET.tickIntervalMs);
    }
  }

  if (next.status === "suffering" && !petStatsAreLow(next)) {
    next.status = "alive";
    next.sufferingStartedAt = null;
  }

  if (next.status === "suffering" && next.sufferingStartedAt) {
    if (now.getTime() - next.sufferingStartedAt.getTime() >= sufferThresholdMs) {
      next.status = "cryo";
      next.cryoAt = now;
    }
  }

  return next;
}

export function awardCoins(pet: PetState, newlyKnown: number, now: Date): { pet: PetState; coinsEarned: number; rescued: boolean } {
  if (pet.status === "graduated" || newlyKnown <= 0) {
    return { pet, coinsEarned: 0, rescued: false };
  }

  const coinsEarned = newlyKnown * PET.coinsPerKnownWord;
  const next: PetState = { ...pet, coins: pet.coins + coinsEarned };
  let rescued = false;

  if (next.status === "cryo") {
    rescued = true;
    next.status = "alive";
    next.cryoAt = null;
    next.sufferingStartedAt = null;
    next.hunger = Math.max(next.hunger, PET.rescueRestore);
    next.mood = Math.max(next.mood, PET.rescueRestore);
    next.lastTickAt = now;
  } else if (next.status === "suffering") {
    next.status = "alive";
    next.sufferingStartedAt = null;
  }

  return { pet: next, coinsEarned, rescued };
}

export function maybeGraduate(pet: PetState, knownCount: number, totalWords: number, now: Date): PetState {
  if (pet.status === "graduated") return pet;
  if (totalWords > 0 && knownCount >= totalWords) {
    return {
      ...pet,
      status: "graduated",
      graduatedAt: now,
      sufferingStartedAt: null,
    };
  }
  return pet;
}

export function applyCare(pet: PetState, action: PetAction): PetState {
  if (pet.status === "cryo" || pet.status === "graduated") {
    throw new HttpError("Pet cannot be cared for now", 409, "pet_unavailable");
  }
  if (pet.coins < PET.actionCost) {
    throw new HttpError("Not enough coins", 400, "no_coins");
  }
  const stat = ACTIONS[action];
  const next: PetState = {
    ...pet,
    coins: pet.coins - PET.actionCost,
    [stat]: clampStat(pet[stat] + PET.actionGain),
  };
  if (next.status === "suffering") {
    next.status = "alive";
    next.sufferingStartedAt = null;
  }
  return next;
}

function fromRow(row: PetRow): PetState {
  return {
    coins: Number(row.coins),
    hunger: Number(row.hunger),
    mood: Number(row.mood),
    home: Number(row.home),
    study: Number(row.study),
    status: row.status,
    lastTickAt: new Date(row.last_tick_at),
    sufferingStartedAt: row.suffering_started_at ? new Date(row.suffering_started_at) : null,
    cryoAt: row.cryo_at ? new Date(row.cryo_at) : null,
    graduatedAt: row.graduated_at ? new Date(row.graduated_at) : null,
  };
}

export function toSnapshot(pet: PetState, knownCount: number): PetSnapshot {
  return {
    coins: pet.coins,
    hunger: pet.hunger,
    mood: pet.mood,
    home: pet.home,
    study: pet.study,
    status: pet.status,
    lastTickAt: pet.lastTickAt.toISOString(),
    sufferingStartedAt: pet.sufferingStartedAt?.toISOString() ?? null,
    cryoAt: pet.cryoAt?.toISOString() ?? null,
    graduatedAt: pet.graduatedAt?.toISOString() ?? null,
    knownCount,
    totalWords: dictionary.words.size,
    actionCost: PET.actionCost,
    coinsPerKnownWord: PET.coinsPerKnownWord,
    coinsPerInvite: PET.coinsPerInvite,
  };
}

async function ensurePet(tx: Queryable, userId: string): Promise<void> {
  await tx`
    INSERT INTO pets (user_id, coins, hunger, mood)
    VALUES (${userId}::bigint, ${PET.startingCoins}, ${PET.startingHunger}, ${PET.startingMood})
    ON CONFLICT (user_id) DO NOTHING
  `;
}

async function lockPet(tx: Queryable, userId: string): Promise<PetState> {
  const rows = await tx<PetRow[]>`
    SELECT coins, hunger, mood, home, study, status, last_tick_at, suffering_started_at, cryo_at, graduated_at
    FROM pets
    WHERE user_id = ${userId}::bigint
    FOR UPDATE
  `;
  if (!rows[0]) throw new HttpError("Pet is missing", 500, "pet_missing");
  return fromRow(rows[0]);
}

async function savePet(tx: Queryable, userId: string, pet: PetState): Promise<void> {
  await tx`
    UPDATE pets SET
      coins = ${pet.coins},
      hunger = ${pet.hunger},
      mood = ${pet.mood},
      home = ${pet.home},
      study = ${pet.study},
      status = ${pet.status},
      last_tick_at = ${pet.lastTickAt},
      suffering_started_at = ${pet.sufferingStartedAt},
      cryo_at = ${pet.cryoAt},
      graduated_at = ${pet.graduatedAt}
    WHERE user_id = ${userId}::bigint
  `;
}

export async function countKnownWords(tx: Queryable, userId: string): Promise<number> {
  const rows = await tx<{ word_id: string }[]>`
    SELECT word_id FROM word_progress
    WHERE user_id = ${userId}::bigint AND language = ${activeLanguage()} AND status = 'known'
  `;
  const known = new Set<string>();
  for (const row of rows) {
    const wordId = dictionary.resolveWordId(row.word_id);
    if (dictionary.words.has(wordId)) known.add(wordId);
  }
  return known.size;
}

export async function evolveLockedPet(
  tx: Queryable,
  userId: string,
  now = new Date(),
): Promise<{ pet: PetState; knownCount: number }> {
  await ensurePet(tx, userId);
  let pet = applyTick(await lockPet(tx, userId), now);
  const knownCount = await countKnownWords(tx, userId);
  pet = maybeGraduate(pet, knownCount, dictionary.words.size, now);
  await savePet(tx, userId, pet);
  return { pet, knownCount };
}

export async function loadAndTickPet(user: AppUser): Promise<{ pet: PetSnapshot; rescued: boolean }> {
  return sql.begin(async (tx) => {
    const { pet, knownCount } = await evolveLockedPet(tx, user.id);
    return { pet: toSnapshot(pet, knownCount), rescued: false };
  });
}

export async function careForPet(user: AppUser, action: PetAction): Promise<PetSnapshot> {
  if (!(action in ACTIONS)) {
    throw new HttpError("Unknown pet action", 400, "bad_request");
  }
  return sql.begin(async (tx) => {
    const now = new Date();
    const { pet: ticked, knownCount } = await evolveLockedPet(tx, user.id, now);
    const next = applyCare(ticked, action);
    await savePet(tx, user.id, next);
    return toSnapshot(next, knownCount);
  });
}

export async function persistPet(tx: Queryable, userId: string, pet: PetState): Promise<void> {
  await savePet(tx, userId, pet);
}

export { ensurePet, lockPet };
