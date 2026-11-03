import { useCallback, useEffect, useRef, useState } from "react";
import { postProgress } from "./api";
import { localDate } from "./localDate";
import type { ProgressItem, ProgressResult, SessionWord, WordStats } from "./types";

function emptyStats(): WordStats {
  return { correct: 0, wrong: 0, known: false };
}

export type SessionLive = {
  correct: number;
  wrong: number;
  known: number;
  /** Coins returned by /progress for words learned in this session. */
  coinsEarned: number;
  /** Latest Moti balance from the pet snapshot, when we have one. */
  balance: number | null;
};

function totals(stats: Map<string, WordStats>): Pick<SessionLive, "correct" | "wrong" | "known"> {
  let correct = 0;
  let wrong = 0;
  let known = 0;
  for (const item of stats.values()) {
    correct += item.correct;
    wrong += item.wrong;
    if (item.known) known += 1;
  }
  return { correct, wrong, known };
}

export function useSessionProgress(themeId: string, words: SessionWord[], balance: number | null = null) {
  const current = useRef(new Map<string, WordStats>());
  const flushed = useRef(new Map<string, WordStats>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const [live, setLive] = useState<SessionLive>({
    correct: 0,
    wrong: 0,
    known: 0,
    coinsEarned: 0,
    balance,
  });

  if (current.current.size === 0) {
    for (const word of words) {
      current.current.set(word.id, emptyStats());
      flushed.current.set(word.id, emptyStats());
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (balance === null) return;
    setLive((prev) => (prev.balance === null ? { ...prev, balance } : prev));
  }, [balance]);

  const publish = useCallback(() => {
    const next = totals(current.current);
    setLive((prev) => ({ ...prev, ...next }));
  }, []);

  const diff = useCallback((): ProgressItem[] => {
    const items: ProgressItem[] = [];
    for (const [wordId, stats] of current.current) {
      const prev = flushed.current.get(wordId) ?? emptyStats();
      const correct = stats.correct - prev.correct;
      const wrong = stats.wrong - prev.wrong;
      const knownBecameTrue = stats.known && !prev.known;
      if (correct === 0 && wrong === 0 && !knownBecameTrue) continue;
      items.push({
        wordId,
        themeId,
        correct,
        wrong,
        known: stats.known,
        knownOn: localDate(),
      });
    }
    return items;
  }, [themeId]);

  const applyResult = useCallback((result: ProgressResult) => {
    if (!mounted.current) return;
    setLive((prev) => ({
      ...prev,
      coinsEarned: prev.coinsEarned + result.coinsEarned,
      balance: typeof result.pet?.coins === "number" ? result.pet.coins : prev.balance,
    }));
  }, []);

  const flush = useCallback(async (keepalive = false) => {
    const run = async () => {
      const items = diff();
      if (items.length === 0) return;
      const rollback = new Map<string, WordStats>();
      for (const item of items) {
        rollback.set(item.wordId, { ...(flushed.current.get(item.wordId) ?? emptyStats()) });
        const stats = current.current.get(item.wordId) ?? emptyStats();
        flushed.current.set(item.wordId, { ...stats });
      }
      try {
        const result = await postProgress(items, keepalive);
        if (result && typeof result.coinsEarned === "number") applyResult(result);
      } catch (error) {
        for (const [wordId, stats] of rollback) flushed.current.set(wordId, stats);
        throw error;
      }
    };

    const task = chain.current.then(run, run);
    chain.current = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
  }, [applyResult, diff]);

  const bump = useCallback((wordId: string, delta: Partial<WordStats>) => {
    const stats = current.current.get(wordId) ?? emptyStats();
    const next = {
      correct: stats.correct + (delta.correct ?? 0),
      wrong: stats.wrong + (delta.wrong ?? 0),
      known: delta.known ?? stats.known,
    };
    current.current.set(wordId, next);
    publish();
    // Study-known words pay Moti. The amount is coinsEarned from /progress, not a local rate.
    // «Уже знаю» never comes through bump, so it stays out of this counter.
    const prev = flushed.current.get(wordId) ?? emptyStats();
    if (next.known && !prev.known) void flush().catch(() => undefined);
  }, [flush, publish]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    const onUnload = () => {
      void flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flush]);

  return { bump, flush, live };
}
