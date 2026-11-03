import { describe, expect, it } from "vitest";
import { applyTick, awardCoins, maybeGraduate, PET, type PetState } from "./pet.js";

function pet(over: Partial<PetState> = {}): PetState {
  return {
    coins: 0,
    hunger: PET.startingHunger,
    mood: PET.startingMood,
    home: 55,
    study: 40,
    status: "alive",
    lastTickAt: new Date("2026-10-08T10:00:00.000Z"),
    sufferingStartedAt: null,
    cryoAt: null,
    graduatedAt: null,
    ...over,
  };
}

const hour = PET.tickIntervalMs;
const suffer = 72 * hour;

describe("pet tick", () => {
  it("starts content: above the sad line and not already happy", () => {
    expect(PET.startingHunger).toBeGreaterThanOrEqual(PET.lowStat);
    expect(PET.startingMood).toBeGreaterThanOrEqual(PET.lowStat);
    expect(PET.startingHunger).toBeLessThan(70);
    expect(PET.startingMood).toBeLessThan(70);
  });

  it("starts suffering when coins stay at 0, then goes to cryo after the threshold", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    const broke = applyTick(pet({ coins: 0, hunger: 0, mood: 0 }), now, suffer);
    expect(broke.status).toBe("suffering");
    expect(broke.coins).toBe(0);
    expect(broke.sufferingStartedAt?.toISOString()).toBe("2026-10-08T11:00:00.000Z");

    const frozen = applyTick(broke, new Date("2026-10-11T11:00:00.000Z"), suffer);
    expect(frozen.status).toBe("cryo");
    expect(frozen.cryoAt).toBeTruthy();
  });

  it("stays alive while broke if hunger and mood are still above the low-stat line", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    const full = applyTick(pet({ coins: 0, hunger: 80, mood: 80 }), now, suffer);
    expect(full.status).toBe("alive");
    expect(full.sufferingStartedAt).toBeNull();
    expect(full.hunger).toBe(64);
    expect(full.mood).toBe(64);
  });

  it("enters suffering only after brokeDecay drops a bar below lowStat", () => {
    const now = new Date("2026-10-08T11:00:00.000Z");
    const hurting = applyTick(pet({ coins: 0, hunger: 36, mood: 40 }), now, suffer);
    expect(hurting.status).toBe("suffering");
    expect(hurting.hunger).toBe(28);
    expect(hurting.mood).toBe(32);
    expect(hurting.sufferingStartedAt?.toISOString()).toBe("2026-10-08T11:00:00.000Z");
  });

  it("flips stale suffering back to alive when both bars are still high", () => {
    const now = new Date("2026-10-08T10:00:00.000Z");
    const recovered = applyTick(
      pet({
        coins: 0,
        hunger: 90,
        mood: 88,
        status: "suffering",
        sufferingStartedAt: new Date("2026-10-05T10:00:00.000Z"),
      }),
      now,
      suffer,
    );
    expect(recovered.status).toBe("alive");
    expect(recovered.sufferingStartedAt).toBeNull();
    expect(recovered.cryoAt).toBeNull();
  });

  it("does not consume coins after graduation", () => {
    const later = new Date("2026-10-10T10:00:00.000Z");
    const done = applyTick(
      pet({
        coins: 40,
        status: "graduated",
        graduatedAt: new Date("2026-10-08T12:00:00.000Z"),
      }),
      later,
      suffer,
    );
    expect(done.status).toBe("graduated");
    expect(done.coins).toBe(40);
    expect(done.lastTickAt.toISOString()).toBe("2026-10-08T10:00:00.000Z");
  });
});

describe("pet coins and win", () => {
  it("awards coins once conceptually and thaws cryo", () => {
    const now = new Date("2026-10-08T15:00:00.000Z");
    const thawed = awardCoins(pet({ status: "cryo", cryoAt: now, coins: 0 }), 1, now);
    expect(thawed.coinsEarned).toBe(PET.coinsPerKnownWord);
    expect(thawed.rescued).toBe(true);
    expect(thawed.pet.status).toBe("alive");
    expect(thawed.pet.coins).toBe(PET.coinsPerKnownWord);
  });

  it("graduates when every catalog word is known", () => {
    const now = new Date("2026-10-08T16:00:00.000Z");
    const won = maybeGraduate(pet({ coins: 20, status: "alive" }), 100, 100, now);
    expect(won.status).toBe("graduated");
    expect(won.graduatedAt?.toISOString()).toBe(now.toISOString());
  });
});
