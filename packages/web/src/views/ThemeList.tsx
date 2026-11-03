import { useState } from "react";
import { groupMediaThemes, ruEpisodes } from "../mediaGroup";
import { CEFR_LEVELS, type ThemeBlockSummary, type ThemeSummary } from "../types";
import { CatalogRequest } from "./CatalogRequest";
import { SearchField } from "./SearchField";

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");
}

function mediaSearchHaystack(theme: ThemeSummary): string {
  return normalizeSearch(
    [theme.title, theme.showTitle, theme.year != null ? String(theme.year) : "", kindLabel(theme.kind)]
      .filter(Boolean)
      .join(" "),
  );
}

function kindLabel(kind: ThemeSummary["kind"]): string | null {
  if (kind === "series") return "Сериал";
  if (kind === "episode") return "Серия";
  if (kind === "movie") return "Фильм";
  if (kind === "text") return "Текст";
  return null;
}

export function AccessBadge({ theme, subscribed = false }: { theme: ThemeSummary; subscribed?: boolean }) {
  if (subscribed || theme.kind === "text") return null;
  if (theme.freePick) {
    return <span className="access-badge access-badge-free">Твой выбор</span>;
  }
  if (theme.referralPick) {
    return <span className="access-badge access-badge-free">За друга</span>;
  }
  if (theme.claimable) {
    return <span className="access-badge access-badge-free">Можно выбрать</span>;
  }
  if (!theme.paid) {
    return <span className="access-badge access-badge-free">Бесплатно</span>;
  }
  if (theme.locked) {
    return <span className="access-badge access-badge-locked">Подписка</span>;
  }
  return <span className="access-badge access-badge-included">В подписке</span>;
}

export function StudyingBadge() {
  return <span className="access-badge access-badge-studying">Учу</span>;
}

export function ThemeCard({
  theme,
  onOpen,
  highlightStudying = true,
  subscribed = false,
}: {
  theme: ThemeSummary;
  onOpen: (theme: ThemeSummary) => void;
  highlightStudying?: boolean;
  subscribed?: boolean;
}) {
  const percent = theme.wordCount === 0 ? 0 : Math.round((theme.knownCount / theme.wordCount) * 100);
  const showStudying = highlightStudying && theme.studying;
  const kind = kindLabel(theme.kind);
  const showBadges = showStudying || Boolean(kind) || (!subscribed && theme.kind !== "text");
  return (
    <button
      type="button"
      className={`theme-card${theme.posterUrl ? " media-card" : ""}${showStudying ? " studying-card" : ""}`}
      onClick={() => onOpen(theme)}
    >
      {theme.posterUrl ? (
        <span className="theme-poster-slot">
          <img
            className="theme-poster"
            src={theme.posterUrl}
            alt=""
            width={96}
            height={144}
            referrerPolicy="no-referrer"
          />
        </span>
      ) : null}
      <div className="theme-card-body">
        <div className="theme-card-head">
          <strong className="theme-card-title">{theme.title}</strong>
          {showBadges ? (
            <span className="theme-card-badges">
              {showStudying ? <StudyingBadge /> : null}
              {kind ? <span className="access-badge access-badge-kind">{kind}</span> : null}
              <AccessBadge theme={theme} subscribed={subscribed} />
            </span>
          ) : null}
        </div>
        <div className="bar" aria-hidden>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="row theme-card-meta">
          <span>
            {theme.kind === "series" && theme.episodes
              ? `${ruEpisodes(theme.episodes.length)} · ${theme.knownCount} / ${theme.wordCount} слов`
              : `${theme.knownCount} / ${theme.wordCount} слов`}
          </span>
          {theme.locked ? <span className="lock">🔒</span> : null}
        </div>
        <div className="level-pills" aria-label="Уровни CEFR">
          {CEFR_LEVELS.filter((level) => theme.levels[level] > 0).map((level) => (
            <span key={level} className="level-pill">
              {level} {theme.knownByLevel[level]}/{theme.levels[level]}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

export type ThemeCatalogView = "cards" | "outline";

/** Survives leaving the list (the screen unmounts) and resets when the app loads. */
let sessionCatalogView: ThemeCatalogView = "outline";

function ThemeOutlineRow({
  theme,
  onOpen,
  subscribed = false,
}: {
  theme: ThemeSummary;
  onOpen: (theme: ThemeSummary) => void;
  subscribed?: boolean;
}) {
  return (
    <li>
      <button type="button" className="theme-outline-row" onClick={() => onOpen(theme)}>
        <span className="theme-outline-name">{theme.title}</span>
        <span className="theme-outline-side">
          {theme.studying ? <StudyingBadge /> : null}
          <AccessBadge theme={theme} subscribed={subscribed} />
          <span className="theme-outline-count" aria-label={`${theme.knownCount} из ${theme.wordCount} слов`}>
            {theme.knownCount}/{theme.wordCount}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ThemeOutlineList({
  themes,
  onOpen,
  subscribed = false,
}: {
  themes: ThemeSummary[];
  onOpen: (theme: ThemeSummary) => void;
  subscribed?: boolean;
}) {
  return (
    <ul className="theme-outline-list">
      {themes.map((theme) => (
        <ThemeOutlineRow key={theme.id} theme={theme} onOpen={onOpen} subscribed={subscribed} />
      ))}
    </ul>
  );
}

function ThemeOutline({
  sections,
  onOpen,
  subscribed = false,
}: {
  sections: ThemeBlockSummary[];
  onOpen: (theme: ThemeSummary) => void;
  subscribed?: boolean;
}) {
  return (
    <div className="theme-outline">
      {sections.map((block) => (
        <section key={block.id} className="theme-outline-group" aria-labelledby={`outline-${block.id}`}>
          <h2 id={`outline-${block.id}`} className="theme-outline-heading">
            {block.title}
          </h2>
          <ThemeOutlineList themes={block.themes} onOpen={onOpen} subscribed={subscribed} />
        </section>
      ))}
    </div>
  );
}

export function ThemeList({
  blocks,
  themes,
  onOpen,
  section = "all",
  showTitles = true,
  mediaRequests = true,
  subscribed = false,
}: {
  blocks?: ThemeBlockSummary[];
  themes: ThemeSummary[];
  onOpen: (theme: ThemeSummary) => void;
  section?: "all" | "media" | "words";
  showTitles?: boolean;
  mediaRequests?: boolean;
  subscribed?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ThemeCatalogView>(sessionCatalogView);
  const needle = normalizeSearch(query);
  const showViewSwitch = section === "words";
  const outline = showViewSwitch && view === "outline";

  function chooseView(next: ThemeCatalogView) {
    sessionCatalogView = next;
    setView(next);
  }
  const sections = (
    blocks && blocks.length > 0
      ? blocks.filter((block) => block.themes.length > 0)
      : [{ id: "all", title: "Темы", order: 0, themes }]
  ).filter((block) => {
    if (section === "media") return block.id === "media";
    if (section === "words") return block.id !== "media";
    return true;
  });
  const mediaItems = groupMediaThemes(sections.find((block) => block.id === "media")?.themes ?? []);
  const visibleMedia = needle
    ? mediaItems.filter((theme) => mediaSearchHaystack(theme).includes(needle))
    : mediaItems;

  return (
    <div className="theme-blocks">
      {showViewSwitch ? (
        <div className="catalog-view-bar">
          <div className="catalog-view" role="group" aria-label="Вид списка тем">
            <button
              type="button"
              className="catalog-view-option"
              aria-pressed={view === "cards"}
              onClick={() => chooseView("cards")}
            >
              Карточки
            </button>
            <button
              type="button"
              className="catalog-view-option"
              aria-pressed={view === "outline"}
              onClick={() => chooseView("outline")}
            >
              Оглавление
            </button>
          </div>
        </div>
      ) : null}
      {section === "media" ? (
        <label className="media-search">
          <span className="sr-only">Поиск фильма или сериала</span>
          <SearchField
            className="input media-search-input"
            value={query}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Название фильма или сериала"
            onChange={setQuery}
          />
        </label>
      ) : null}
      {section === "media" && mediaRequests ? <CatalogRequest /> : null}
      {outline ? (
        <ThemeOutline
          sections={sections.filter((block) => block.id !== "media")}
          onOpen={onOpen}
          subscribed={subscribed}
        />
      ) : (
        sections.map((block) => {
          const items = block.id === "media" ? visibleMedia : block.themes;
          return (
            <section key={block.id} className="theme-block">
              {showTitles ? <h2 className="theme-block-title">{block.title}</h2> : null}
              {block.id === "media" && needle && items.length === 0 ? (
                <p className="word-list-hint">Ничего не нашлось. Попробуй другое название.</p>
              ) : (
                <div className="list">
                  {items.map((theme) => (
                    <ThemeCard key={theme.id} theme={theme} onOpen={onOpen} subscribed={subscribed} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
