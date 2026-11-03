import type { ThemeSummary } from "../types";
import { ruEpisodes } from "../mediaGroup";
import { ScreenHeader } from "./ScreenHeader";
import { ThemeCard } from "./ThemeList";

export function SeriesScreen({
  show,
  busy,
  subscribed = false,
  onBack,
  onOpen,
  onRemoveStudying,
}: {
  show: ThemeSummary;
  busy?: boolean;
  subscribed?: boolean;
  onBack: () => void;
  onOpen: (theme: ThemeSummary) => void;
  onRemoveStudying?: (theme: ThemeSummary) => void;
}) {
  const episodes = show.episodes ?? [];
  const percent = show.wordCount === 0 ? 0 : Math.round((show.knownCount / show.wordCount) * 100);

  return (
    <>
      <ScreenHeader title={show.title} onBack={onBack} />
      {show.posterUrl ? (
        <img
          className="theme-poster-hero"
          src={show.posterUrl}
          alt=""
          width={120}
          height={180}
          referrerPolicy="no-referrer"
        />
      ) : null}
      <p>
        {show.knownCount} из {show.wordCount} слов · {ruEpisodes(episodes.length)} · {percent}%
      </p>
      <div className="bar studying-bar" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
      {show.studying && onRemoveStudying ? (
        <button
          type="button"
          className="ghost word-list-entry"
          disabled={busy}
          onClick={() => onRemoveStudying(show)}
        >
          {busy ? "Удаляем…" : "Удалить из Изучаю"}
        </button>
      ) : null}
      <h2 className="category-heading">Серии</h2>
      <p className="word-list-hint">Категории слов открываются внутри серии.</p>
      <div className="list">
        {episodes.map((episode) => (
          <ThemeCard key={episode.id} theme={episode} subscribed={subscribed} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}
