import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CEFR_LEVELS,
  type CefrLevel,
  type SessionMode,
  type ThemeCategorySummary,
  type ThemeSummary,
} from "../types";
import { modeHelp } from "../modeHelp";
import { ModeHelpLines } from "./ModeHelpLines";
import { ScreenHeader } from "./ScreenHeader";

function remaining(known: number, total: number): number {
  return Math.max(0, total - known);
}

const steps: { id: SessionMode; title: string; hint?: string }[] = [
  { id: "learn", title: "Учить" },
  { id: "match", title: "Пары", hint: "Сетка 6+6, таймер на устройстве" },
  { id: "control", title: "Контрольная" },
  { id: "review", title: "Экзамен" },
];

export function ThemeScreen({
  theme,
  busy,
  onBack,
  onMode,
  onWordList,
  onRemoveStudying,
}: {
  theme: ThemeSummary;
  busy?: boolean;
  onBack: () => void;
  onMode: (mode: SessionMode, level: CefrLevel | null, categoryId?: string | null) => void;
  onWordList: (level: CefrLevel | null, categoryId?: string | null) => void;
  onRemoveStudying?: (theme: ThemeSummary) => void;
}) {
  const categories = theme.categories ?? [];
  const isFilm = theme.kind === "movie" || theme.kind === "episode";
  const isText = theme.kind === "text";
  const isPack = isFilm || isText;
  const showLevelPicker = !isText;
  const available = useMemo(
    () => CEFR_LEVELS.filter((level) => theme.levels[level] > 0),
    [theme],
  );
  const [level, setLevel] = useState<CefrLevel | null>(
    theme.id === "my-words" || isText ? null : (available[0] ?? null),
  );
  const selectedLevel = showLevelPicker ? level : null;

  const wordCount = selectedLevel ? theme.levels[selectedLevel] : theme.wordCount;
  const knownCount = selectedLevel ? theme.knownByLevel[selectedLevel] : theme.knownCount;
  const canPractice = remaining(knownCount, wordCount) > 0;
  const canRemove = Boolean(
    theme.studying &&
      onRemoveStudying &&
      (theme.kind === "movie" || theme.kind === "episode" || theme.kind === "text"),
  );

  return (
    <>
      <ScreenHeader title={theme.title} onBack={onBack} />
      {theme.posterUrl ? (
        <img
          className="theme-poster-hero"
          src={theme.posterUrl}
          alt=""
          width={120}
          height={180}
          referrerPolicy="no-referrer"
        />
      ) : null}
      <p>
        {knownCount} из {wordCount} слов закрыто
        {selectedLevel ? ` · ${selectedLevel}` : ""}
      </p>

      {showLevelPicker ? (
        <LevelPicker theme={theme} level={level} available={available} onSelect={setLevel} />
      ) : null}

      <button type="button" className="ghost word-list-entry" onClick={() => onWordList(selectedLevel)}>
        Посмотреть список слов
      </button>

      <StudySteps canPractice={canPractice} onStart={(mode) => onMode(mode, selectedLevel)} />

      {canRemove ? (
        <button
          type="button"
          className="ghost word-list-entry"
          disabled={busy}
          onClick={() => onRemoveStudying?.(theme)}
        >
          {busy ? "Удаляем…" : "Удалить из Изучаю"}
        </button>
      ) : null}

      {isPack && categories.length > 0 ? (
        <>
          <h2 className="category-heading">Категории</h2>
          <p className="word-list-hint">
            {theme.kind === "text"
              ? "Только слова из этого текста. «Учить» у категории ниже запускает занятия по ним."
              : `Только слова, которые звучали в этом ${theme.kind === "episode" ? "эпизоде" : "фильме"}.`}
          </p>
          <div className="category-list">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                onLearn={() => onMode("learn", null, category.id)}
                onOpen={() => onWordList(null, category.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function LevelPicker({
  theme,
  level,
  available,
  onSelect,
}: {
  theme: ThemeSummary;
  level: CefrLevel | null;
  available: CefrLevel[];
  onSelect: (level: CefrLevel | null) => void;
}) {
  return (
    <div className="level-picker" role="group" aria-label="Уровень сложности">
      {available.map((item) => (
        <button
          key={item}
          type="button"
          className={`level-chip${level === item ? " active" : ""}`}
          onClick={() => onSelect(item)}
        >
          <strong>{item}</strong>
          <span>
            {theme.knownByLevel[item]}/{theme.levels[item]}
          </span>
        </button>
      ))}
      <button
        type="button"
        className={`level-chip${level === null ? " active" : ""}`}
        onClick={() => onSelect(null)}
      >
        <strong>Все</strong>
        <span>
          {theme.knownCount}/{theme.wordCount}
        </span>
      </button>
    </div>
  );
}

function StudySteps({
  canPractice,
  onStart,
}: {
  canPractice: boolean;
  onStart: (mode: SessionMode) => void;
}) {
  const [help, setHelp] = useState<SessionMode | null>(null);
  const helpReturn = useRef<HTMLButtonElement | null>(null);
  const closeHelp = useCallback(() => {
    setHelp(null);
    helpReturn.current?.focus();
    helpReturn.current = null;
  }, []);
  const helpStep = steps.find((step) => step.id === help);

  return (
    <>
      <p className="memory-steps">
        Для лучшего подхода в изучении слов на основе научных исследований по работе памяти рекомендуем выполнить по порядку все шаги
      </p>

      <div className="modes">
        {steps.map((step, index) => {
          const label = `${index + 1}. ${step.title}`;
          const ready = step.id === "control" || step.id === "review" || canPractice;
          return (
            <div key={step.id} className="mode-row">
              <button
                type="button"
                className={step.id === "learn" ? "mode-card primary" : "mode-card"}
                disabled={!ready}
                onClick={() => onStart(step.id)}
              >
                <strong>{label}</strong>
                {step.hint ? <p>{step.hint}</p> : null}
              </button>
              <button
                type="button"
                className="mode-info"
                aria-label={`Что делает «${label}»`}
                aria-expanded={help === step.id}
                aria-controls={help === step.id ? "mode-help-dialog" : undefined}
                onClick={(event) => {
                  helpReturn.current = event.currentTarget;
                  setHelp(step.id);
                }}
              >
                <InfoIcon />
              </button>
            </div>
          );
        })}
      </div>
      {help && helpStep ? (
        <ModeHelp
          title={`${steps.findIndex((step) => step.id === help) + 1}. ${helpStep.title}`}
          lines={modeHelp[help]}
          onClose={closeHelp}
        />
      ) : null}
    </>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="8" r="1.15" fill="currentColor" />
      <path d="M12 11.2v6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function ModeHelp({ title, lines, onClose }: { title: string; lines: readonly string[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mode-help-backdrop" onClick={onClose}>
      <div
        id="mode-help-dialog"
        className="mode-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mode-help-head">
          <h2 id="mode-help-title">{title}</h2>
          <button ref={closeRef} type="button" className="mode-help-close" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <ModeHelpLines lines={lines} />
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  onLearn,
  onOpen,
}: {
  category: ThemeCategorySummary;
  onLearn: () => void;
  onOpen: () => void;
}) {
  const percent = category.wordCount === 0 ? 0 : Math.round((category.knownCount / category.wordCount) * 100);
  const canLearn = remaining(category.knownCount, category.wordCount) > 0;
  return (
    <div className="category-card">
      <button type="button" className="category-card-main" onClick={onOpen}>
        <div className="row">
          <strong>{category.title}</strong>
          <span>
            {category.knownCount}/{category.wordCount}
          </span>
        </div>
        <div className="bar" aria-hidden>
          <span style={{ width: `${percent}%` }} />
        </div>
      </button>
      <button type="button" className="primary category-learn" disabled={!canLearn} onClick={onLearn}>
        Учить
      </button>
    </div>
  );
}
