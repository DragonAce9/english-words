import { useMemo, useState } from "react";
import { answersMatch } from "../normalize";
import { directionLabel, stripArticle, targetWord } from "../word";
import { useSessionProgress } from "../useSessionProgress";
import type { Direction, SessionResponse, SessionWord } from "../types";
import { Done } from "./Learn";
import { PosMark } from "./PosMark";
import { SessionExitBar } from "./SessionExitBar";
import { SessionStatsStrip } from "./SessionStatsStrip";
import { SpeakButton } from "./SpeakButton";

type Item = { word: SessionWord; direction: Direction };

function promptOf(word: SessionWord, direction: Direction): string {
  return direction === "en-ru" ? targetWord(word) : word.ru[0];
}

function expectedOf(word: SessionWord, direction: Direction): string[] {
  return direction === "en-ru" ? word.ru : [targetWord(word)];
}

export function Test({
  session,
  motiCoins = null,
  onDone,
}: {
  session: SessionResponse;
  motiCoins?: number | null;
  onDone: () => void;
}) {
  const initial = useMemo<Item[]>(
    () =>
      session.words.flatMap((word) => [
        { word, direction: "en-ru" as const },
        { word, direction: "ru-en" as const },
      ]),
    [session.words],
  );
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [mistakes, setMistakes] = useState<Item[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState({ ok: 0, total: initial.length });
  const [feedback, setFeedback] = useState<"idle" | "ok" | "bad">("idle");
  const { bump, flush, live } = useSessionProgress(session.themeId, session.words, motiCoins);
  const stats = <SessionStatsStrip live={live} />;
  const passed = useMemo(() => new Map<string, Set<Direction>>(), []);

  const current = queue[index];

  function markPassed(item: Item) {
    const set = passed.get(item.word.id) ?? new Set<Direction>();
    set.add(item.direction);
    passed.set(item.word.id, set);
    if (set.size === 2) bump(item.word.id, { known: true });
  }

  function goNext(nextMistakes: Item[]) {
    if (index + 1 < queue.length) {
      setIndex(index + 1);
      setTyped("");
      setFeedback("idle");
      return;
    }
    if (!retrying) {
      setScore({ ok: queue.length - nextMistakes.length, total: queue.length });
    }
    if (nextMistakes.length > 0 && !retrying) {
      setFinished(true);
      setMistakes(nextMistakes);
      return;
    }
    if (nextMistakes.length > 0 && retrying) {
      setQueue(nextMistakes);
      setMistakes([]);
      setIndex(0);
      setTyped("");
      setFeedback("idle");
      return;
    }
    setFinished(true);
    setMistakes([]);
  }

  if (finished && mistakes.length > 0 && !retrying) {
    return (
      <div className="stack">
        <SessionExitBar flush={flush} onDone={onDone} extra={stats} />
        <div className="score">{Math.round((score.ok / score.total) * 100)}%</div>
        <p>
          Верно {score.ok} из {score.total}. Можно повторить ошибки локально — сервер ещё не вызывается.
        </p>
        <button
          className="primary"
          onClick={() => {
            setQueue(mistakes);
            setIndex(0);
            setTyped("");
            setFinished(false);
            setRetrying(true);
            setFeedback("idle");
          }}
        >
          Повторить ошибки
        </button>
        <button
          className="ghost"
          onClick={async () => {
            await flush();
            onDone();
          }}
        >
          Сохранить и выйти
        </button>
      </div>
    );
  }

  if (!current || (finished && mistakes.length === 0)) {
    return (
      <Done
        title={`${Math.round((score.ok / Math.max(score.total, 1)) * 100)}%`}
        hint="Тест сохранён одним запросом"
        onExit={async () => {
          await flush();
          onDone();
        }}
      />
    );
  }

  return (
    <>
      <SessionExitBar flush={flush} onDone={onDone} extra={stats}>
        <p className="progress">
          {index + 1} / {queue.length}
          {retrying ? " · повтор" : ""}
        </p>
      </SessionExitBar>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (feedback !== "idle") return;
          const expected = expectedOf(current.word, current.direction);
          const typedValue = current.direction === "ru-en" ? stripArticle(typed) : typed;
          const ok = answersMatch(
            typedValue,
            current.direction === "ru-en" ? expected.map((item) => stripArticle(item)) : expected,
          );
          bump(current.word.id, ok ? { correct: 1 } : { wrong: 1 });
          setFeedback(ok ? "ok" : "bad");
          const nextMistakes = ok ? mistakes : [...mistakes, current];
          if (ok) markPassed(current);
          window.setTimeout(() => goNext(nextMistakes), 550);
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
          {expectedOf(current.word, current.direction).length > 1
            ? "Подойдёт любой перевод из карточки. Не нужно писать все через слэш. Регистр и ё/е не важны."
            : "Напиши перевод. Регистр и ё/е не важны."}
        </p>
        <input
          className="input"
          value={typed}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="Перевод"
          onChange={(event) => setTyped(event.target.value)}
        />
        <div className={`feedback ${feedback}`}>
          {feedback === "bad" ? expectedOf(current.word, current.direction).join(" / ") : " "}
        </div>
        <button className="primary" type="submit">
          Ответить
        </button>
      </form>
    </>
  );
}
