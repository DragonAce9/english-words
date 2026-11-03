import { localDate } from "./localDate";
import type { SessionResponse } from "./types";

export function filterKnownFromSession(session: SessionResponse, knownIds: Set<string>): SessionResponse {
  if (knownIds.size === 0) return session;
  return {
    ...session,
    words: session.words.filter((word) => !knownIds.has(word.id)),
    choices: session.choices.filter((choice) => !knownIds.has(choice.wordId)),
    matchRounds: session.matchRounds
      .map((round) => round.filter((pair) => !knownIds.has(pair.id)))
      .filter((round) => round.length > 0),
  };
}

export function knownProgressItems(themeId: string, wordIds: string[]) {
  return wordIds.map((wordId) => ({
    wordId,
    themeId,
    correct: 0,
    wrong: 0,
    known: true,
    knownOn: localDate(),
  }));
}
