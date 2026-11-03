import type { GuideTry, PetSnapshot, ThemeSummary } from "./types";

const ORDER: GuideTry[] = ["moti", "study", "words", "path"];

/** Same value as PET.startingHunger and PET.startingMood. Care is a bar rising past this. */
const MOTI_START_STAT = 60;

export function mergeGuideTries(...groups: readonly (readonly string[])[]): GuideTry[] {
  const have = new Set(groups.flat());
  return ORDER.filter((id) => have.has(id));
}

export function guideStepDone(
  id: GuideTry,
  tries: readonly string[],
  pet: PetSnapshot,
  themes: readonly ThemeSummary[],
): boolean {
  if (tries.includes(id)) return true;
  if (id === "moti") return pet.hunger > MOTI_START_STAT || pet.mood > MOTI_START_STAT;
  if (id === "study") return pet.knownCount > 0;
  if (id === "path") return themes.some((theme) => theme.studying);
  return false;
}

export function practiceTheme(themes: readonly ThemeSummary[]): ThemeSummary | undefined {
  return (
    themes.find((theme) => theme.id === "numbers" && !theme.locked) ??
    themes.find((theme) => !theme.locked && theme.kind == null)
  );
}
