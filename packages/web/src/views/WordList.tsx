import { useLayoutEffect, useMemo, useState } from "react";
import type { ThemeWordListItem, ThemeWordListResponse } from "../types";
import { targetWord } from "../word";
import { KnowButton } from "./KnowButton";
import { PosMark } from "./PosMark";
import { ReportWord } from "./ReportWord";
import { ScreenHeader } from "./ScreenHeader";
import { SearchField } from "./SearchField";
import { SpeakButton } from "./SpeakButton";

type Filter = "all" | "known" | "learning";

function compareWords(a: ThemeWordListItem, b: ThemeWordListItem, language: string, themeId: string): number {
  if (themeId === "numbers") return 0;
  const head = targetWord(a).localeCompare(targetWord(b), language, { sensitivity: "base" });
  return head || a.id.localeCompare(b.id);
}

function WordRow({
  word,
  themeId,
  busy,
  onToggle,
}: {
  word: ThemeWordListItem;
  themeId: string;
  busy: boolean;
  onToggle: (word: ThemeWordListItem, known: boolean) => void;
}) {
  return (
    <div className={`word-row${word.known ? " known" : ""}`}>
      <button
        type="button"
        className="word-row-main"
        disabled={busy}
        onClick={() => onToggle(word, !word.known)}
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
        <KnowButton known={word.known} disabled={busy} onClick={() => onToggle(word, !word.known)} />
        <ReportWord word={word} themeId={themeId} />
      </div>
    </div>
  );
}

export function WordList({
  list,
  language = "en",
  busyId,
  markingAll,
  onBack,
  onToggle,
  onMarkAll,
}: {
  list: ThemeWordListResponse;
  language?: string;
  busyId?: string | null;
  markingAll?: boolean;
  onBack: () => void;
  onToggle: (word: ThemeWordListItem, known: boolean) => void;
  onMarkAll: (words: ThemeWordListItem[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.words
      .filter((word) => {
        if (filter === "known" && !word.known) return false;
        if (filter === "learning" && word.known) return false;
        if (!q) return true;
        return (
          targetWord(word).toLowerCase().includes(q) ||
          word.wordCyrillic?.toLowerCase().includes(q) ||
          word.en.toLowerCase().includes(q) ||
          word.ru.some((ru) => ru.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => compareWords(a, b, language, list.themeId));
  }, [filter, language, list.themeId, list.words, query]);

  const knownCount = list.words.filter((word) => word.known).length;
  const unknownVisible = visible.filter((word) => !word.known);
  const listBusy = Boolean(markingAll || busyId);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector(".app")?.scrollTo(0, 0);
  }, []);

  return (
    <div className="word-list-screen">
      <ScreenHeader title={list.title} onBack={onBack} />

      <p className="word-list-lead">
        {knownCount} из {list.words.length} знаю
        {list.level ? ` · ${list.level}` : ""}
      </p>

      <SearchField
        className="word-list-search"
        value={query}
        onChange={setQuery}
        placeholder="Поиск…"
        autoCapitalize="off"
        autoCorrect="off"
      />

      <div className="word-list-filters" role="group" aria-label="Фильтр">
        {(
          [
            ["all", "Все"],
            ["learning", "Учить"],
            ["known", "Знаю"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`level-chip${filter === id ? " active" : ""}`}
            onClick={() => setFilter(id)}
          >
            <strong>{label}</strong>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="ghost mark-all-known"
        disabled={listBusy || unknownVisible.length === 0}
        onClick={() => onMarkAll(unknownVisible)}
      >
        Отметить все как знаю
      </button>

      <div className="known-list">
        {visible.length === 0 ? <p className="word-list-empty">Ничего не найдено</p> : null}
        {visible.map((word) => (
          <WordRow
            key={word.id}
            word={word}
            themeId={list.themeId}
            busy={busyId === word.id || Boolean(markingAll)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
