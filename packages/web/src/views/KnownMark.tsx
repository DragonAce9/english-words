import { useState } from "react";
import type { SessionMode, SessionResponse } from "../types";
import { targetWord } from "../word";
import { KnowButton } from "./KnowButton";
import { PosMark } from "./PosMark";
import { ReportWord } from "./ReportWord";
import { SessionExitBar } from "./SessionExitBar";
import { SpeakButton } from "./SpeakButton";

const modeTitle: Record<SessionMode, string> = {
  learn: "Обучение",
  match: "Пары",
  control: "Контрольная",
  review: "Экзамен",
};

export function KnownMark({
  session,
  mode,
  busy,
  onBack,
  onConfirm,
}: {
  session: SessionResponse;
  mode: SessionMode;
  busy?: boolean;
  onBack: () => void;
  onConfirm: (knownIds: string[]) => void;
}) {
  const [known, setKnown] = useState<Set<string>>(() => new Set());
  const remaining = session.words.length - known.size;

  function toggle(id: string) {
    setKnown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function markAllListed() {
    setKnown(new Set(session.words.map((word) => word.id)));
  }

  return (
    <>
      <SessionExitBar onDone={onBack} disabled={busy}>
        <h1>{modeTitle[mode]}</h1>
      </SessionExitBar>
      <p>Слова с «Знаю» не попадут в эту сессию.</p>
      <div className="known-mark-bar">
        <p className="progress">
          Уже знаю {known.size} · останется {remaining}
        </p>
        <button
          type="button"
          className="ghost mark-all-known"
          disabled={busy || session.words.length === 0 || remaining === 0}
          onClick={markAllListed}
        >
          Отметить все как знаю
        </button>
      </div>
      <div className="known-list known-mark-list">
        {session.words.map((word) => {
          const marked = known.has(word.id);
          return (
            <div key={word.id} className={`word-row${marked ? " known" : ""}`}>
              <button
                type="button"
                className="word-row-main"
                disabled={busy}
                onClick={() => toggle(word.id)}
              >
                <span className="word-en">
                  <strong>
                    {targetWord(word)}
                    {word.wordCyrillic ? <span className="word-cyr"> {word.wordCyrillic}</span> : null}
                  </strong>
                  <PosMark pos={word.pos} gender={word.gender} />
                </span>
                <span className="ru">{word.ru.join(" / ")}</span>
              </button>
              <div className="word-row-actions">
                <SpeakButton text={targetWord(word)} />
                <KnowButton known={marked} disabled={busy} onClick={() => toggle(word.id)} />
                <ReportWord word={word} themeId={session.themeId} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="sticky-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => onConfirm([...known])}
        >
          {remaining === 0 ? "К теме" : "Учить оставшиеся"}
        </button>
      </div>
    </>
  );
}
