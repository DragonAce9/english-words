import { useEffect, useRef, useState } from "react";
import { addStudyWord, lookupDictionary, searchDictionary, setWordKnown, visibleError } from "../api";
import type { DictionaryHit, DictionarySearch, ProgressResult } from "../types";
import { targetWord } from "../word";
import { KnowButton } from "./KnowButton";
import { PosMark } from "./PosMark";
import { ReportWord } from "./ReportWord";
import { ScreenHeader } from "./ScreenHeader";
import { SearchField } from "./SearchField";
import { SpeakButton } from "./SpeakButton";

export function DictionaryScreen({
  onBack,
  onKnown,
  onStudied,
}: {
  onBack: () => void;
  onKnown?: (result: ProgressResult, known: boolean) => void;
  onStudied?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DictionarySearch | null>(null);
  const [looking, setLooking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const id = ++requestId.current;
    setChecked(false);
    if (trimmed.length < 2) {
      setResult(null);
      setError("");
      return;
    }
    const timer = window.setTimeout(() => {
      searchDictionary(trimmed)
        .then((next) => {
          if (requestId.current === id) {
            setResult(next);
            setError("");
          }
        })
        .catch((err: Error) => {
          if (requestId.current === id) setError(visibleError(err, "Не удалось найти слово. Попробуйте ещё раз."));
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function find() {
    const trimmed = query.trim();
    if (trimmed.length < 2 || result?.exact) return;
    const id = ++requestId.current;
    setLooking(true);
    setError("");
    try {
      const next = await lookupDictionary(trimmed);
      if (requestId.current !== id) return;
      setResult(next);
      setChecked(true);
    } catch (err) {
      if (requestId.current === id) setError(visibleError(err, "Не удалось найти слово. Попробуйте ещё раз."));
    } finally {
      if (requestId.current === id) setLooking(false);
    }
  }

  const showAi = Boolean(result && !result.exact && query.trim().length >= 2);

  return (
    <div className="dictionary">
      <ScreenHeader title="Словарь" onBack={onBack} />
      <form
        className="dictionary-search"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <SearchField
          className="word-list-search"
          value={query}
          autoFocus
          placeholder="Слово или русский перевод"
          autoCapitalize="off"
          autoCorrect="off"
          onChange={setQuery}
        />
      </form>
      {error ? <p className="feedback bad">{error}</p> : null}
      {result?.added ? <p className="dictionary-added">Слово добавлено в словарь</p> : null}
      {result?.corrected && result.exact ? <p className="word-list-hint">Исправлена опечатка</p> : null}
      {result?.exact ? (
        <div className="dictionary-cards">
          {result.hits.map((hit) => (
            <DictionaryCard
              key={hit.id}
              hit={hit}
              query={result.query}
              fresh={result.added}
              onError={setError}
              onKnown={onKnown}
              onStudied={onStudied}
            />
          ))}
        </div>
      ) : null}
      {result?.exact && result.alternatives.length > 0 ? (
        <SuggestList title="Другие варианты" hits={result.alternatives} onPick={setQuery} />
      ) : null}
      {showAi && result ? (
        <div className="dictionary-miss">
          {result.hits.length > 0 ? (
            <SuggestList
              title={result.corrected ? "Возможно, вы имели в виду" : undefined}
              hits={result.hits}
              onPick={setQuery}
            />
          ) : result.alternatives.length === 0 ? (
            <p className="word-list-hint">
              {checked ? "Такого слова нет. Проверьте написание." : "В базе такого слова пока нет."}
            </p>
          ) : null}
          {result.alternatives.length > 0 ? (
            <SuggestList title="Возможно, вы имели в виду" hits={result.alternatives} onPick={setQuery} />
          ) : null}
          {checked && result.hits.length === 0 && result.alternatives.length === 0 ? null : (
            <button type="button" className="primary" disabled={looking} onClick={() => void find()}>
              {looking ? "Ищу…" : `Найти «${query.trim()}»`}
            </button>
          )}
        </div>
      ) : null}
      {!result && query.trim().length < 2 ? (
        <p className="word-list-hint">Введите слово или русский перевод.</p>
      ) : null}
    </div>
  );
}

function SuggestList({
  title,
  hits,
  onPick,
}: {
  title?: string;
  hits: DictionaryHit[];
  onPick: (query: string) => void;
}) {
  return (
    <div className="dictionary-miss">
      {title ? <p className="word-list-hint">{title}</p> : null}
      <div className="dictionary-suggest">
        {hits.map((hit) => (
          <button key={hit.id} type="button" className="dictionary-suggest-item" onClick={() => onPick(targetWord(hit))}>
            <strong>{targetWord(hit)}</strong>
            <span>{hit.ru.join(" / ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function categoryLine(hit: DictionaryHit): string {
  const titles = (hit.themes ?? []).map((theme) => theme.title).filter(Boolean);
  return titles.length > 0 ? titles.join(" · ") : hit.themeTitle;
}

function formMatches(form: string, query: string): boolean {
  const needle = query.toLowerCase();
  return form.toLowerCase().split(/[^a-z]+/).includes(needle);
}

const FORM_LABELS = ["Инфинитив", "Прошедшее", "Причастие"];

function DictionaryCard({
  hit,
  query,
  fresh,
  onError,
  onKnown,
  onStudied,
}: {
  hit: DictionaryHit;
  query: string;
  fresh: boolean;
  onError: (message: string) => void;
  onKnown?: (result: ProgressResult, known: boolean) => void;
  onStudied?: () => void;
}) {
  const [known, setKnown] = useState(hit.known);
  const [studying, setStudying] = useState(Boolean(hit.studying));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setKnown(hit.known);
    setStudying(Boolean(hit.studying));
  }, [hit.id, hit.known, hit.studying]);

  async function study() {
    setBusy(true);
    onError("");
    try {
      await addStudyWord(hit.id);
      setStudying(true);
      onStudied?.();
    } catch (err) {
      onError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleKnown() {
    const next = !known;
    setBusy(true);
    onError("");
    try {
      const result = await setWordKnown(hit.themeId, hit.id, next);
      setKnown(next);
      onKnown?.(result, next);
    } catch (err) {
      onError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  const title = hit.forms?.[0] ?? targetWord(hit);

  return (
    <article className="dictionary-card">
      <header>
        <strong>{title}</strong>
        <SpeakButton text={title} />
        <PosMark pos={hit.pos} gender={hit.gender} />
        <span className="pill">{hit.level}</span>
        {studying ? <span className="pill">Учу</span> : null}
        {known ? <span className="pill">Знаю</span> : null}
        {fresh ? <span className="pill">Новое</span> : null}
        <ReportWord word={{ id: hit.id, en: hit.en, word: hit.word }} themeId={hit.themeId} />
      </header>
      {hit.forms ? (
        <div className="dictionary-forms" aria-label="Три формы глагола">
          {hit.forms.map((form, index) => (
            <span key={`${index}-${form}`} className={formMatches(form, query) ? "match" : undefined}>
              <small>{FORM_LABELS[index]}</small>
              <strong>{form}</strong>
            </span>
          ))}
        </div>
      ) : null}
      <p className="ru">{hit.ru.join(" / ")}</p>
      {hit.example ? <p className="dictionary-example">{hit.example}</p> : null}
      {hit.source ? <p className="dictionary-source">{hit.source}</p> : null}
      <em>{categoryLine(hit)}</em>
      <div className="dictionary-actions">
        <button
          type="button"
          className={`study-btn${studying ? " studying" : ""}`}
          aria-pressed={studying}
          disabled={busy}
          onClick={() => void study()}
        >
          Учить
        </button>
        <KnowButton known={known} disabled={busy} onClick={() => void toggleKnown()} />
      </div>
    </article>
  );
}
