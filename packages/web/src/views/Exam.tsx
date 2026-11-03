import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postProgress, visibleError } from "../api";
import { answersMatch } from "../normalize";
import { directionLabel, stripArticle, studiedForms, targetWord } from "../word";
import type { Direction, ProgressResult, SessionWord } from "../types";
import { PosMark } from "./PosMark";
import { SessionExitBar } from "./SessionExitBar";
import { SpeakButton } from "./SpeakButton";

type Item = { word: SessionWord; direction: Direction };
type Sides = { "en-ru": boolean | null; "ru-en": boolean | null };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function promptOf(word: SessionWord, direction: Direction): string {
  return direction === "en-ru" ? targetWord(word) : word.ru[0];
}

function expectedOf(word: SessionWord, direction: Direction): string[] {
  return direction === "en-ru" ? word.ru : studiedForms(word);
}

export function Exam({
  words,
  onProgress,
  onBindFlush,
  onDone,
}: {
  words: SessionWord[];
  onProgress?: (result: ProgressResult) => void;
  onBindFlush?: (flush: (() => Promise<void>) | null) => void;
  onDone: () => void;
}) {
  const queue = useMemo<Item[]>(() => {
    const first = shuffle(words);
    const second = shuffle(words);
    return [
      ...first.map((word) => ({ word, direction: "en-ru" as const })),
      ...second.map((word) => ({ word, direction: "ru-en" as const })),
    ];
  }, [words]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "ok" | "bad">("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ passed: number; failed: number } | null>(null);
  const sides = useRef(new Map<string, Sides>());
  const posted = useRef(new Set<string>());
  const advanceRef = useRef<number | null>(null);

  const flush = useCallback(async () => {
    const items = [];
    for (const [wordId, pair] of sides.current) {
      if (posted.current.has(wordId)) continue;
      const passed = pair["en-ru"] === true && pair["ru-en"] === true;
      const failed = pair["en-ru"] === false || pair["ru-en"] === false;
      if (!passed && !failed) continue;
      posted.current.add(wordId);
      const correct = (pair["en-ru"] === true ? 1 : 0) + (pair["ru-en"] === true ? 1 : 0);
      const wrong = (pair["en-ru"] === false ? 1 : 0) + (pair["ru-en"] === false ? 1 : 0);
      items.push({
        wordId,
        themeId: "exam",
        correct,
        wrong,
        known: passed,
        awardCoins: false,
        demote: failed,
        examined: passed,
      });
    }
    if (items.length === 0) return;
    const result = await postProgress(items);
    if (result) onProgress?.(result);
  }, [onProgress]);

  useEffect(() => {
    onBindFlush?.(flush);
    return () => onBindFlush?.(null);
  }, [flush, onBindFlush]);

  useEffect(
    () => () => {
      if (advanceRef.current != null) window.clearTimeout(advanceRef.current);
    },
    [],
  );

  function tally() {
    let passed = 0;
    let failed = 0;
    for (const pair of sides.current.values()) {
      if (pair["en-ru"] === true && pair["ru-en"] === true) passed += 1;
      else if (pair["en-ru"] === false || pair["ru-en"] === false) failed += 1;
    }
    return { passed, failed };
  }

  function moveNext() {
    if (advanceRef.current != null) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
    if (index + 1 >= queue.length) setSummary(tally());
    else {
      setIndex(index + 1);
      setTyped("");
      setFeedback("idle");
    }
  }

  const current = queue[index];

  if (summary) {
    return (
      <div className="stack">
        <div className="card flashcard">
          <div className="prompt">Экзамен сдан</div>
          <p>Помнишь: {summary.passed}</p>
          <p>Снова в изучении: {summary.failed}</p>
        </div>
        <button className="primary" onClick={onDone}>
          К Изучаю
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="stack">
        <p>В этом экзамене нет слов.</p>
        <button className="primary" onClick={onDone}>
          К Изучаю
        </button>
      </div>
    );
  }

  return (
    <>
      <SessionExitBar
        flush={flush}
        onDone={onDone}
        disabled={saving}
      >
        <p className="progress">
          Экзамен · {index + 1} / {queue.length}
        </p>
      </SessionExitBar>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (feedback !== "idle" || saving) return;
          const expected = expectedOf(current.word, current.direction);
          const typedValue = current.direction === "ru-en" ? stripArticle(typed) : typed;
          const ok = answersMatch(
            typedValue,
            current.direction === "ru-en" ? expected.map((item) => stripArticle(item)) : expected,
          );
          const pair = sides.current.get(current.word.id) ?? { "en-ru": null, "ru-en": null };
          pair[current.direction] = ok;
          sides.current.set(current.word.id, pair);
          setFeedback(ok ? "ok" : "bad");
          setSaveError(null);
          const decided =
            (pair["en-ru"] === true && pair["ru-en"] === true) ||
            pair["en-ru"] === false ||
            pair["ru-en"] === false;
          const go = () => {
            if (!ok) return;
            advanceRef.current = window.setTimeout(() => {
              advanceRef.current = null;
              moveNext();
            }, 600);
          };
          if (!decided) {
            go();
            return;
          }
          setSaving(true);
          void flush()
            .then(() => {
              setSaving(false);
              go();
            })
            .catch((err: unknown) => {
              posted.current.delete(current.word.id);
              setSaving(false);
              setSaveError(visibleError(err, "Не удалось сохранить"));
            });
        }}
      >
        <span className="card-meta">
          <span className="pill">{directionLabel(current.direction)}</span>
          <PosMark pos={current.word.pos} gender={current.word.gender} />
        </span>
        <div className="speak-row">
          <h2>{promptOf(current.word, current.direction)}</h2>
          {current.direction === "en-ru" ? <SpeakButton text={targetWord(current.word)} /> : null}
        </div>
        <p className="word-list-hint">
          {current.direction === "ru-en" && current.word.wordCyrillic
            ? "Подойдёт латиница или кириллица. Регистр и ё/е не важны."
            : expectedOf(current.word, current.direction).length > 1
              ? "Подойдёт любой из переводов. Регистр и ё/е не важны."
              : "Напиши перевод. Регистр и ё/е не важны."}
        </p>
        <input
          className="input"
          value={typed}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="Перевод"
          readOnly={feedback !== "idle" || saving}
          onChange={(event) => setTyped(event.target.value)}
        />
        <div className={`feedback ${feedback}`}>
          {feedback === "bad" ? expectedOf(current.word, current.direction).join(" / ") : " "}
        </div>
        {saveError ? <p className="feedback bad">{saveError}</p> : null}
        {saveError ? (
          <button
            className="primary"
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void flush()
                .then(() => {
                  setSaving(false);
                  setSaveError(null);
                  if (index + 1 >= queue.length) setSummary(tally());
                  else {
                    setIndex(index + 1);
                    setTyped("");
                    setFeedback("idle");
                  }
                })
                .catch((err: unknown) => {
                  posted.current.delete(current.word.id);
                  setSaving(false);
                  setSaveError(visibleError(err, "Не удалось сохранить"));
                });
            }}
          >
            Сохранить и дальше
          </button>
        ) : feedback === "bad" ? (
          <button className="primary" type="button" disabled={saving} onClick={moveNext}>
            Дальше
          </button>
        ) : (
          <button className="primary" type="submit" disabled={feedback !== "idle" || saving}>
            Ответить
          </button>
        )}
      </form>
    </>
  );
}
