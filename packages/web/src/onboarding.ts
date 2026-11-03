import type { PetSnapshot, ThemesResponse } from "./types";

const CACHE_KEY = "onboarding_done";

export function forceOnboarding(search = window.location.search): boolean {
  return new URLSearchParams(search).get("onboarding") === "1";
}

export function cachedOnboardingDone(): boolean {
  try {
    return window.localStorage.getItem(CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

export function cacheOnboardingDone(): void {
  try {
    window.localStorage.setItem(CACHE_KEY, "1");
  } catch {
    /* private mode / quota */
  }
}

export function shouldShowOnboarding(
  catalog: ThemesResponse,
  pet: PetSnapshot,
  search = window.location.search,
): boolean {
  if (forceOnboarding(search)) return true;
  if (catalog.devUser && !catalog.onboardingDone) return true;
  if (catalog.onboardingDone || cachedOnboardingDone()) return false;
  // Starter coins are granted on pet create; knownCount is the real “new learner” signal.
  return pet.knownCount === 0 && pet.status === "alive";
}
