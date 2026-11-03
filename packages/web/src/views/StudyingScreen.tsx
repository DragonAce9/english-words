import { groupMediaThemes } from "../mediaGroup";
import type { ThemeSummary } from "../types";
import { ScreenHeader } from "./ScreenHeader";
import { SwipeDelete } from "./SwipeDelete";
import { ThemeCard } from "./ThemeList";

export function StudyingScreen({
  themes,
  busyId,
  showTexts = true,
  subscribed = false,
  onBack,
  onOpen,
  onRemove,
  onOpenFilms,
  onOpenWords,
  onOpenTexts,
}: {
  themes: ThemeSummary[];
  busyId?: string | null;
  showTexts?: boolean;
  subscribed?: boolean;
  onBack: () => void;
  onOpen: (theme: ThemeSummary) => void;
  onRemove: (theme: ThemeSummary) => void;
  onOpenFilms: () => void;
  onOpenWords: () => void;
  onOpenTexts: () => void;
}) {
  const films = groupMediaThemes(
    themes.filter((theme) => theme.kind === "movie" || theme.kind === "episode"),
  ).filter((theme) => theme.studying);
  const textThemes = themes.filter((theme) => theme.studying && theme.kind === "text");
  const wordThemes = themes.filter(
    (theme) =>
      theme.studying &&
      theme.kind !== "movie" &&
      theme.kind !== "episode" &&
      theme.kind !== "series" &&
      theme.kind !== "text",
  );
  const known = themes.filter((theme) => theme.studying).reduce((sum, theme) => sum + theme.knownCount, 0);
  const total = themes.filter((theme) => theme.studying).reduce((sum, theme) => sum + theme.wordCount, 0);
  const percent = total === 0 ? 0 : Math.round((known / total) * 100);
  const empty = films.length === 0 && textThemes.length === 0 && wordThemes.length === 0;

  return (
    <>
      <ScreenHeader title="Изучаю" onBack={onBack} />
      {empty ? (
        <div className="studying-empty">
          <p className="studying-empty-copy">
            {showTexts
              ? "Пока здесь пусто. Сюда попадут темы, фильмы и тексты, которые ты начнёшь учить."
              : "Пока здесь пусто. Сюда попадут темы и фильмы, которые ты начнёшь учить."}
          </p>
          <div className="studying-empty-actions">
            <button type="button" className="ghost" onClick={onOpenFilms}>
              Каталог фильмов
            </button>
            <button type="button" className="primary" onClick={onOpenWords}>
              Каталог слов
            </button>
            {showTexts ? (
              <button type="button" className="ghost" onClick={onOpenTexts}>
                Добавить свой текст
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <p>
            {known} из {total} слов · {percent}%
          </p>
          <p className="word-list-hint">Свайпни влево, чтобы убрать. Прогресс слов останется в обычных темах.</p>
          <div className="bar studying-bar" aria-hidden>
            <span style={{ width: `${percent}%` }} />
          </div>
          {films.length > 0 ? (
            <section className="home-section">
              <h2 className="category-heading">Фильмы и сериалы</h2>
              <div className="list">
                {films.map((theme) => (
                  <SwipeDelete
                    key={theme.id}
                    disabled={busyId === theme.id}
                    onDelete={() => onRemove(theme)}
                  >
                    <ThemeCard theme={theme} highlightStudying={false} subscribed={subscribed} onOpen={onOpen} />
                  </SwipeDelete>
                ))}
              </div>
            </section>
          ) : null}
          {textThemes.length > 0 ? (
            <section className="home-section">
              <h2 className="category-heading">Тексты</h2>
              <div className="list">
                {textThemes.map((theme) => (
                  <SwipeDelete
                    key={theme.id}
                    disabled={busyId === theme.id}
                    onDelete={() => onRemove(theme)}
                  >
                    <ThemeCard theme={theme} highlightStudying={false} subscribed={subscribed} onOpen={onOpen} />
                  </SwipeDelete>
                ))}
              </div>
            </section>
          ) : null}
          {wordThemes.length > 0 ? (
            <section className="home-section">
              <h2 className="category-heading">Темы</h2>
              <div className="list">
                {wordThemes.map((theme) => (
                  <SwipeDelete
                    key={theme.id}
                    disabled={busyId === theme.id}
                    onDelete={() => onRemove(theme)}
                  >
                    <ThemeCard theme={theme} highlightStudying={false} subscribed={subscribed} onOpen={onOpen} />
                  </SwipeDelete>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
