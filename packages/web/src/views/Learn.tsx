import { useEffect, useMemo, useRef, useState } from "react";
import { postProgress, visibleError } from "../api";
import { localDate } from "../localDate";
import { answersMatch } from "../normalize";
import { directionLabel, studiedForms, targetWord } from "../word";
import { stopSpeaking } from "../speak";
import { useSessionProgress } from "../useSessionProgress";
import { CEFR_LEVELS, type Direction, type McChoice, type SessionResponse, type SessionWord } from "../types";
import { PosMark } from "./PosMark";
import { ReportWord } from "./ReportWord";
import { SessionExitBar } from "./SessionExitBar";
import { SessionStatsStrip } from "./SessionStatsStrip";
import { SlowSpeakButton, SpeakButton } from "./SpeakButton";

type Step = "card" | "choice" | "type";
type Item = { word: SessionWord; direction: Direction };

function prompt(word: SessionWord, direction: Direction): string {
  return direction === "en-ru" ? targetWord(word) : word.ru[0];
}

function expected(word: SessionWord, direction: Direction): string[] {
  return direction === "en-ru" ? word.ru : studiedForms(word);
}

function findChoice(choices: McChoice[], wordId: string, direction: Direction): McChoice {
  const found = choices.find((item) => item.wordId === wordId && item.direction === direction);
  if (!found) throw new Error("Missing multiple-choice set");
  return found;
}

export function Learn({
  session,
  motiCoins = null,
  onDone,
}: {
  session: SessionResponse;
  motiCoins?: number | null;
  onDone: () => void;
}) {
  const queue = useMemo<Item[]>(
    () =>
      session.words.flatMap((word) => [
        { word, direction: "en-ru" as const },
        { word, direction: "ru-en" as const },
      ]),
    [session.words],
  );
  const [items, setItems] = useState(queue);
  const [step, setStep] = useState<Step>("card");
  const [flipped, setFlipped] = useState(false);
  const [choiceState, setChoiceState] = useState<"idle" | "ok" | "bad">("idle");
  const [pickedChoice, setPickedChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [typeState, setTypeState] = useState<"idle" | "ok" | "bad">("idle");
  const advanceRef = useRef<number | null>(null);
  const [choiceOk, setChoiceOk] = useState(true);
  const [doneDirections, setDoneDirections] = useState<Record<string, Set<Direction>>>({});
  const [knowing, setKnowing] = useState(false);
  const [knowError, setKnowError] = useState<string | null>(null);
  const [coachSeen, setCoachSeen] = useState({
    flip: false,
    choice: false,
    type: false,
    reverse: false,
  });
  const { bump, flush, live } = useSessionProgress(session.themeId, session.words, motiCoins);

  function seeCoach(key: "flip" | "choice" | "type" | "reverse") {
    setCoachSeen((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }

  function clearAdvance() {
    if (advanceRef.current == null) return;
    window.clearTimeout(advanceRef.current);
    advanceRef.current = null;
  }

  function advanceAfter(ms: number, run: () => void) {
    clearAdvance();
    advanceRef.current = window.setTimeout(() => {
      advanceRef.current = null;
      run();
    }, ms);
  }

  useEffect(() => clearAdvance, []);

  const current = items[0];
  const remaining = items.length;
  const total = queue.length;

  if (!current) {
    return (
      <Done
        title="Обучение закончено"
        onExit={async () => {
          await flush();
          onDone();
        }}
      />
    );
  }

  const mc = findChoice(session.choices, current.word.id, current.direction);
  const englishVisible = current.direction === "en-ru" || flipped;
  const showFlip = step === "card" && !flipped && !coachSeen.flip;
  const showChoice = step === "choice" && !coachSeen.choice;
  const showType = step === "type" && !coachSeen.type;
  const showReverse = step === "card" && current.direction === "ru-en" && !coachSeen.reverse;

  function finishItem(success: boolean) {
    clearAdvance();
    const wordId = current.word.id;
    if (success) {
      const nextSet = new Set(doneDirections[wordId] ?? []);
      nextSet.add(current.direction);
      if (nextSet.size === 2) bump(wordId, { known: true });
      setDoneDirections((prev) => ({ ...prev, [wordId]: nextSet }));
      setItems((prev) => prev.slice(1));
    } else {
      setItems((prev) => [...prev.slice(1), current]);
    }
    seeCoach("type");
    setStep("card");
    setFlipped(false);
    setChoiceState("idle");
    setPickedChoice(null);
    setChoiceOk(true);
    setTyped("");
    setTypeState("idle");
  }

  function skipWord() {
    if (knowing) return;
    clearAdvance();
    stopSpeaking();
    const wordId = current.word.id;
    setItems((prev) => prev.filter((item) => item.word.id !== wordId));
    setStep("card");
    setFlipped(false);
    setChoiceState("idle");
    setPickedChoice(null);
    setChoiceOk(true);
    setTyped("");
    setTypeState("idle");
  }

  async function markAlreadyKnown() {
    if (knowing) return;
    const wordId = current.word.id;
    setKnowing(true);
    setKnowError(null);
    try {
      await postProgress([
        {
          wordId,
          themeId: session.themeId,
          correct: 0,
          wrong: 0,
          known: true,
          awardCoins: false,
          knownOn: localDate(),
        },
      ]);
      setItems((prev) => prev.filter((item) => item.word.id !== wordId));
      seeCoach("flip");
      if (current.direction === "ru-en") seeCoach("reverse");
      setStep("card");
      setFlipped(false);
      setChoiceState("idle");
      setChoiceOk(true);
      setTyped("");
      setTypeState("idle");
    } catch (err) {
      setKnowError(visibleError(err, "Не удалось отметить слово."));
    } finally {
      setKnowing(false);
    }
  }

  return (
    <>
      <SessionExitBar flush={flush} onDone={onDone} extra={<SessionStatsStrip live={live} />}>
        <p className="progress">
          Осталось {remaining} · всего {total}
        </p>
      </SessionExitBar>
      {step === "card" ? (
        <>
          {showReverse ? <p className="learn-step-hint">Теперь в другую сторону</p> : null}
          {showFlip ? <p className="learn-step-hint">Сначала переверни карточку</p> : null}
          <div className="learn-card">
          <div className="learn-face">
          <button
            type="button"
            className={`card flashcard${showFlip ? " learn-nudge" : ""}`}
            onClick={() => {
              setFlipped(true);
              seeCoach("flip");
            }}
          >
            <div className="prompt">
              {flipped ? (
                expected(current.word, current.direction).join(" / ")
              ) : (
                <>
                  {prompt(current.word, current.direction)}
                  {current.direction === "en-ru" && current.word.wordCyrillic ? (
                    <span className="word-cyr">{current.word.wordCyrillic}</span>
                  ) : null}
                </>
              )}
            </div>
            <p>
              {flipped
                ? current.word.example ||
                  (current.direction === "ru-en" && current.word.wordCyrillic
                    ? "Подойдёт латиница или кириллица"
                    : expected(current.word, current.direction).length > 1
                      ? "Подойдёт любой из этих переводов"
                      : "")
                : "Нажми, чтобы перевернуть"}
            </p>
            {flipped && current.word.source ? <p className="dictionary-source">{current.word.source}</p> : null}
          </button>
          {englishVisible ? (
            <div className="card-speak">
              <SpeakButton text={targetWord(current.word)} />
              <SlowSpeakButton text={targetWord(current.word)} />
            </div>
          ) : null}
          <div className="learn-card-bar">
            <span className="card-meta">
              <span className="pill">{directionLabel(current.direction)}</span>
              {CEFR_LEVELS.includes(current.word.level) ? (
                <span className="level-pill">{current.word.level}</span>
              ) : null}
              <PosMark pos={current.word.pos} gender={current.word.gender} />
            </span>
            <button
              type="button"
              className="already-know"
              disabled={knowing}
              onClick={() => void markAlreadyKnown()}
            >
              <span className="already-know-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path
                    d="M5 12.5 10 17.5 19 7.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="already-know-label">Уже знаю</span>
            </button>
          </div>
          <ReportWord key={current.word.id} word={current.word} themeId={session.themeId} />
          </div>
        </div>
        </>
      ) : null}

      {step === "choice" ? (
        <div className="stack">
          <div className="speak-row">
            <h2>{prompt(current.word, current.direction)}</h2>
            {current.direction === "en-ru" ? <SpeakButton text={targetWord(current.word)} /> : null}
          </div>
          {showChoice ? <p className="learn-step-hint">Теперь выбери перевод</p> : null}
          <div className={`choices${showChoice ? " learn-coach" : ""}`}>
            {mc.options.map((option) => (
              <button
                key={option}
                className={`choice ${choiceState !== "idle" && option === mc.answer ? "ok" : ""} ${
                  choiceState === "bad" && option === pickedChoice && option !== mc.answer ? "bad" : ""
                }`}
                disabled={choiceState !== "idle"}
                onClick={() => {
                  if (choiceState !== "idle") return;
                  const ok = option === mc.answer;
                  bump(current.word.id, ok ? { correct: 1 } : { wrong: 1 });
                  setPickedChoice(option);
                  setChoiceOk(ok);
                  setChoiceState(ok ? "ok" : "bad");
                  advanceAfter(ok ? 650 : 1800, () => {
                    seeCoach("choice");
                    setStep("type");
                  });
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === "type" ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (typeState !== "idle") return;
            const ok = answersMatch(typed, expected(current.word, current.direction));
            bump(current.word.id, ok ? { correct: 1 } : { wrong: 1 });
            setTypeState(ok ? "ok" : "bad");
            advanceAfter(ok ? 700 : 3200, () => finishItem(choiceOk && ok));
          }}
        >
          <div className="speak-row">
            <h2>{prompt(current.word, current.direction)}</h2>
            {current.direction === "en-ru" ? <SpeakButton text={targetWord(current.word)} /> : null}
          </div>
          {showType ? <p className="learn-step-hint">Напиши перевод</p> : null}
          <p className="word-list-hint">
            {current.direction === "ru-en" && current.word.wordCyrillic
              ? "Подойдёт латиница или кириллица. Регистр и ё/е не важны."
              : expected(current.word, current.direction).length > 1
                ? "Подойдёт любой перевод с карточки. Не нужно писать все через слэш. Регистр и ё/е не важны."
                : "Напиши перевод как на карточке. Регистр и ё/е не важны."}
          </p>
          <input
            className={`input${showType ? " learn-input-cue" : ""}`}
            value={typed}
            autoFocus={showType}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Введи перевод"
            readOnly={typeState !== "idle"}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className={`feedback ${typeState}`}>
            {typeState === "bad" ? `Правильно: ${expected(current.word, current.direction).join(" / ")}` : " "}
          </div>
          {typeState === "bad" ? (
            <button className="primary" type="button" onClick={() => finishItem(false)}>
              Дальше
            </button>
          ) : (
            <button className="primary" type="submit" disabled={typeState !== "idle"}>
              Проверить
            </button>
          )}
        </form>
      ) : null}

      {step === "card" ? (
        <div className="learn-actions">
          <button
            className="primary learn-next"
            onClick={() => {
              if (current.direction === "ru-en") seeCoach("reverse");
              setStep("choice");
            }}
            disabled={!flipped || knowing}
          >
            Дальше
          </button>
          <button type="button" className="learn-skip" disabled={knowing} onClick={skipWord}>
            Пропустить
          </button>
          {knowError ? <p className="feedback bad">{knowError}</p> : null}
        </div>
      ) : null}
    </>
  );
}

export function Done({ title, hint, onExit }: { title: string; hint?: string; onExit: () => void }) {
  return (
    <div className="stack">
      <div className="card flashcard">
        <div className="prompt">{title}</div>
        {hint ? <p>{hint}</p> : null}
      </div>
      <button className="primary" onClick={onExit}>
        К теме
      </button>
    </div>
  );
}
