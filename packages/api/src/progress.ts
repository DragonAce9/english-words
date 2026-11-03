import { canLearnTheme } from "./access.js";
import { invalidateThemeCatalog } from "./catalogCache.js";
import { activeLanguage } from "./catalogContext.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import {
  applyTick,
  awardCoins,
  countKnownWords,
  ensurePet,
  loadAndTickPet,
  lockPet,
  maybeGraduate,
  persistPet,
  toSnapshot,
} from "./pet.js";
import { parseDay, utcDay } from "./recall.js";
import { HttpError } from "./session.js";
import { enrollStudying } from "./studying.js";
import type { AppUser, DictWord, ProgressItem, ProgressResult } from "./types.js";
import { findUserWord, userOwnsWord } from "./userWords.js";

function catalogAccessible(wordId: string, user: AppUser): boolean {
  const themeIds = dictionary.themesFor(wordId);
  if (themeIds.length === 0) return false;
  return themeIds.some((id) => {
    const theme = dictionary.getTheme(id);
    return theme ? canLearnTheme(theme, user) : false;
  });
}

async function resolveWord(user: AppUser, wordId: string): Promise<DictWord | undefined> {
  return dictionary.getWord(wordId) ?? (await findUserWord(user.id, wordId));
}

async function wordAccessible(wordId: string, user: AppUser): Promise<boolean> {
  if (catalogAccessible(wordId, user)) return true;
  return userOwnsWord(user.id, wordId);
}

export async function saveProgress(user: AppUser, items: ProgressItem[]): Promise<ProgressResult> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError("Progress items are required", 400, "bad_request");
  }

  const cleaned: ProgressItem[] = [];
  for (const item of items) {
    if (!item?.wordId) continue;
    const word = await resolveWord(user, item.wordId);
    if (!word) continue;
    if (!(await wordAccessible(word.id, user))) {
      throw new HttpError("Subscription required", 403, "subscription_required");
    }
    cleaned.push({
      wordId: word.id,
      themeId: item.themeId,
      correct: Math.max(0, Math.trunc(item.correct ?? 0)),
      wrong: Math.max(0, Math.trunc(item.wrong ?? 0)),
      known: Boolean(item.known),
      awardCoins: item.awardCoins !== false,
      demote: Boolean(item.demote),
      examined: Boolean(item.examined),
      knownOn: parseDay(item.knownOn) ?? utcDay(),
    });
  }

  if (cleaned.length === 0) {
    const { pet } = await loadAndTickPet(user);
    return { updated: 0, coinsEarned: 0, rescued: false, pet };
  }

  return sql.begin(async (tx) => {
    const now = new Date();
    await ensurePet(tx, user.id);
    let pet = applyTick(await lockPet(tx, user.id), now);

    const wordIds = [...new Set(cleaned.map((item) => item.wordId))];
    const rows = await tx<{ word_id: string; status: string; rewarded: boolean }[]>`
      SELECT word_id, status, rewarded
      FROM word_progress
      WHERE user_id = ${user.id}::bigint
        AND language = ${activeLanguage()}
        AND word_id IN ${tx(wordIds)}
    `;
    const alreadyKnown = new Set<string>();
    const alreadyRewarded = new Set<string>();
    for (const row of rows) {
      const wordId = dictionary.resolveWordId(row.word_id);
      if (row.status === "known") alreadyKnown.add(wordId);
      if (row.rewarded) alreadyRewarded.add(wordId);
    }
    // Coins are paid once per word. A later exam miss can send it back to study,
    // but becoming known again does not pay.
    const pays = (item: ProgressItem) =>
      item.known &&
      !item.demote &&
      item.awardCoins !== false &&
      !alreadyKnown.has(item.wordId) &&
      !alreadyRewarded.has(item.wordId);
    const newlyKnown = cleaned.filter(pays).length;

    for (const item of cleaned) {
      const demote = Boolean(item.demote);
      const becomingKnown = item.known && !demote;
      const status = becomingKnown ? "known" : "learning";
      // Explicit list toggle: known:false with no score delta clears "known".
      // Session progress always sends score deltas, so it keeps sticky known.
      // demote forces learning even when the word was known and the answer was wrong.
      const clearKnown = !item.known && !demote && item.correct === 0 && item.wrong === 0;
      const markRewarded = becomingKnown;
      const markExam = becomingKnown && Boolean(item.examined);
      const clearExam = demote || clearKnown;
      // «Знаю» with no score delta starts the known day over and clears control.
      // A study session that newly marks the word known does the same once.
      // Score updates on an already-known word leave the day and control flag alone.
      const explicitKnown = becomingKnown && item.correct === 0 && item.wrong === 0;
      const day = item.knownOn ?? utcDay();
      const knownOn = becomingKnown ? day : null;
      await tx`
        INSERT INTO word_progress (user_id, language, word_id, theme_id, status, correct_count, wrong_count, rewarded, examined, known_on, control_passed, updated_at)
        VALUES (${user.id}::bigint, ${activeLanguage()}, ${item.wordId}, NULL, ${status}, ${item.correct}, ${item.wrong}, ${markRewarded}, ${markExam}, ${knownOn}::date, false, now())
        ON CONFLICT (user_id, language, word_id) DO UPDATE SET
          theme_id = NULL,
          status = CASE
            WHEN ${demote} THEN 'learning'
            WHEN EXCLUDED.status = 'known' THEN 'known'
            WHEN ${clearKnown} THEN EXCLUDED.status
            WHEN word_progress.status = 'known' THEN 'known'
            ELSE EXCLUDED.status
          END,
          correct_count = word_progress.correct_count + EXCLUDED.correct_count,
          wrong_count = word_progress.wrong_count + EXCLUDED.wrong_count,
          rewarded = word_progress.rewarded OR EXCLUDED.rewarded,
          examined = CASE
            WHEN ${markExam} THEN true
            WHEN ${clearExam} THEN false
            ELSE word_progress.examined
          END,
          known_on = CASE
            WHEN ${demote} OR ${clearKnown} THEN NULL
            WHEN ${explicitKnown} THEN ${day}::date
            WHEN ${becomingKnown} AND word_progress.status <> 'known' THEN ${day}::date
            ELSE word_progress.known_on
          END,
          control_passed = CASE
            WHEN ${demote} OR ${clearKnown} OR ${explicitKnown} THEN false
            WHEN ${becomingKnown} AND word_progress.status <> 'known' THEN false
            ELSE word_progress.control_passed
          END,
          control_passed_on = CASE
            WHEN ${demote} OR ${clearKnown} OR ${explicitKnown} THEN NULL
            WHEN ${becomingKnown} AND word_progress.status <> 'known' THEN NULL
            ELSE word_progress.control_passed_on
          END,
          exam_passed = CASE
            WHEN ${demote} OR ${clearKnown} OR ${explicitKnown} THEN false
            WHEN ${becomingKnown} AND word_progress.status <> 'known' THEN false
            ELSE word_progress.exam_passed
          END,
          updated_at = now()
      `;
    }

    const awarded = awardCoins(pet, newlyKnown, now);
    pet = awarded.pet;
    const knownCount = await countKnownWords(tx, user.id);
    pet = maybeGraduate(pet, knownCount, dictionary.words.size, now);
    await persistPet(tx, user.id, pet);
    return {
      updated: cleaned.length,
      coinsEarned: awarded.coinsEarned,
      rescued: awarded.rescued,
      pet: toSnapshot(pet, knownCount),
    };
  }).then(async (result) => {
    invalidateThemeCatalog(user.id);
    const themeIds = [
      ...new Set(
        cleaned
          .map((item) => item.themeId)
          .filter((id): id is string => Boolean(id) && id !== "exam"),
      ),
    ];
    for (const themeId of themeIds) await enrollStudying(user, themeId);
    return result;
  });
}
