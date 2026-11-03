import { useEffect, useRef, useState } from "react";
import { gradeRecall, visibleError } from "../api";
import { modeHelp } from "../modeHelp";
import type { SessionResponse } from "../types";
import { studiedForms } from "../word";
import { Done } from "./Learn";
import { ModeHelpLines } from "./ModeHelpLines";
import { PosMark } from "./PosMark";
import { SessionExitBar } from "./SessionExitBar";

export function Recall({ session, onDone }: { session: SessionResponse; onDone: () => void }) {
  const stage = session.mode === "review" ? "review" : "control";
  const title = stage === "review" ? "Экзамен" : "Контрольная";
  const empty = modeHelp[stage];
  const words = session.words;
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "ok" | "bad">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const advanceRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (advanceRef.current != null) window.clearTimeout(advanceRef.current);
    },
    [],
  );

  if (words.length === 0) {
    return (
      <div className="stack">
        <SessionExitBar onDone={onDone}>
          <h1>{title}</h1>
        </SessionExitBar>
        <ModeHelpLines lines={empty} />
      </div>
    );
  }

  if (finished) {
    return <Done title="Готово" onExit={onDone} />;
  }

  const current = words[index];
  if (!current) return <Done title="Готово" onExit={onDone} />;

  const locked = saving || feedback !== "idle";

  function goNext() {
    if (advanceRef.current != null) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
    if (index + 1 >= words.length) setFinished(true);
    else {
      setIndex(index + 1);
      setTyped("");
      setFeedback("idle");
      setError(null);
    }
  }

  return (
    <>
      <SessionExitBar onDone={onDone} disabled={saving}>
        <p className="progress">
          {title} · {index + 1} / {words.length}
        </p>
      </SessionExitBar>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked) return;
          setSaving(true);
          setError(null);
          void gradeRecall({
            themeId: session.themeId,
            mode: stage,
            wordId: current.id,
            answer: typed,
            level: session.level,
            categoryId: session.categoryId,
          })
            .then((result) => {
              setFeedback(result.correct ? "ok" : "bad");
              if (!result.correct) return;
              advanceRef.current = window.setTimeout(() => {
                advanceRef.current = null;
                goNext();
              }, 700);
            })
            .catch((err: unknown) => {
              setError(visibleError(err, "Не удалось проверить ответ"));
            })
            .finally(() => setSaving(false));
        }}
      >
        {current.gender ? (
          <span className="card-meta">
            <PosMark pos={current.pos} gender={current.gender} />
          </span>
        ) : null}
        <h2>{current.ru.join(" / ")}</h2>
        <p className="word-list-hint">
          {current.wordCyrillic
            ? "Напиши слово латиницей или кириллицей. Регистр не важен."
            : "Напиши слово. Регистр не важен."}
        </p>
        <input
          className="input"
          value={typed}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Слово"
          disabled={locked}
          onChange={(event) => setTyped(event.target.value)}
        />
        <div className={`feedback ${feedback}`}>
          {feedback === "bad" ? `Правильно: ${studiedForms(current).join(" / ")}` : feedback === "ok" ? "Верно" : " "}
        </div>
        {error ? <p className="feedback bad">{error}</p> : null}
        {feedback === "bad" ? (
          <button className="primary" type="button" onClick={goNext}>
            Дальше
          </button>
        ) : (
          <button className="primary" type="submit" disabled={locked}>
            Ответить
          </button>
        )}
      </form>
    </>
  );
}
