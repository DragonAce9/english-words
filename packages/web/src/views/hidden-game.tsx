import { useEffect, useRef, useState, type RefObject } from "react";
import { addStudyWord, visibleError } from "../api";
import { getInitData, openTelegramShare } from "../telegram";
import { ScreenHeader } from "./ScreenHeader";

type Bucket = "green" | "yellow" | "red";

type GuessRow = {
  word: string;
  rank: number | null;
  far: boolean;
  hint: boolean;
  bot: string | null;
  botName: string | null;
  studyId: string | null;
  studying: boolean;
  bucket: Bucket;
  seq: number;
};

type Passport = {
  word: string;
  translation: string;
  posLabel: string;
  transcription: string | null;
  definition: string | null;
  origin: string | null;
  wordId: string;
  nearest: { word: string; rank: number }[];
  shareText: string;
};

type GameView = {
  status: "playing" | "won" | "surrendered";
  attempts: number;
  hintCost: number;
  score: number;
  nextCloserCost: number;
  bots: number;
  opponents: string[];
  hints: {
    pos: string | null;
    theme: string | null;
    pattern: string | null;
    translation: string | null;
  };
  guesses: GuessRow[];
  passport: Passport | null;
};

type GameStats = {
  played: number;
  solved: number;
  averageAttempts: number | null;
  bestScore: number | null;
  averageHints: number | null;
};

type GameState = {
  available: boolean;
  levels: string[];
  themes: string[];
  game: GameView | null;
  stats: GameStats;
};

type CallError = Error & { status?: number; code?: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const initData = getInitData();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (initData) {
    headers.set("Authorization", `tma ${initData}`);
    headers.set("X-Telegram-Init-Data", initData);
  } else {
    headers.set("Authorization", "dev");
  }
  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(body.error || "Не получилось") as CallError;
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body as T;
}

function loadState(): Promise<GameState> {
  return call<GameState>("/wordtron");
}

const BOT_ORDER = ["mira", "gleb", "sonya"];

function chipKey(guess: GuessRow): string {
  return `${guess.bot ?? (guess.hint ? "hint" : "you")}:${guess.word}`;
}

export function HiddenHomeEntry({ onOpen }: { onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    loadState()
      .then((state) => {
        if (alive) setOpen(state.available);
      })
      .catch(() => {
        if (alive) setOpen(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!open) return null;
  return (
    <button type="button" className="home-link" onClick={onOpen}>
      <span>Wordtron</span>
      <em>Скрытая игра</em>
    </button>
  );
}

export function HiddenStats({ onOpen }: { onOpen: () => void }) {
  const [stats, setStats] = useState<GameStats | null>(null);
  useEffect(() => {
    let alive = true;
    loadState()
      .then((state) => {
        if (alive && state.available) setStats(state.stats);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!stats) return null;
  return (
    <section className="aside-stats">
      <div className="aside-stats-head">
        <h2>Wordtron</h2>
        <button type="button" className="home-more" onClick={onOpen}>
          Играть
        </button>
      </div>
      <dl>
        <div>
          <dt>Сыграно</dt>
          <dd>{stats.played}</dd>
        </div>
        <div>
          <dt>Угадано</dt>
          <dd>{stats.solved}</dd>
        </div>
        <div>
          <dt>Среднее попыток</dt>
          <dd>{stats.averageAttempts ?? "—"}</dd>
        </div>
        <div>
          <dt>Лучший счёт</dt>
          <dd>{stats.bestScore ?? "—"}</dd>
        </div>
        <div>
          <dt>Подсказок в среднем</dt>
          <dd>{stats.averageHints ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

export function HiddenScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const [level, setLevel] = useState("");
  const [theme, setTheme] = useState("");
  const [bots, setBots] = useState(0);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [studied, setStudied] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [misses, setMisses] = useState<{ id: number; text: string; after: number }[]>([]);
  const missId = useRef(0);
  const syncedBots = useRef(false);
  const revealTimers = useRef<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const newestRef = useRef<HTMLLIElement>(null);
  const opened = useRef(false);
  const [held, setHeld] = useState<Set<string>>(() => new Set());
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => {
    if (!state?.game || syncedBots.current) return;
    setBots(state.game.bots);
    syncedBots.current = true;
  }, [state]);

  function clearReveal() {
    for (const id of revealTimers.current) window.clearTimeout(id);
    revealTimers.current = [];
  }

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
      const overlap = Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height);
      document.documentElement.style.setProperty("--kb", `${Math.round(overlap)}px`);
    };
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    sync();
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--kb");
      clearReveal();
    };
  }, []);

  useEffect(() => {
    if (scrollTick === 0) return;
    const scroller = scrollRef.current;
    const row = newestRef.current;
    if (!scroller || !row) return;
    const frame = window.requestAnimationFrame(() => {
      const scrollerRect = scroller.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const delta = rowRect.bottom - scrollerRect.bottom + 10;
      if (Math.abs(delta) > 2) scroller.scrollBy({ top: delta, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollTick]);

  useEffect(() => {
    let alive = true;
    loadState()
      .then((next) => {
        if (alive) setState(next);
      })
      .catch((error: CallError) => {
        if (alive) setNote(visibleError(error, "Не удалось загрузить игру."));
      });
    return () => {
      alive = false;
    };
  }, []);

  function stageReveal(previous: GuessRow[], next: GuessRow[]) {
    const seen = new Set(previous.map(chipKey));
    const bots = next
      .filter((guess) => guess.bot && !guess.hint && !seen.has(chipKey(guess)))
      .sort((a, b) => BOT_ORDER.indexOf(a.bot ?? "") - BOT_ORDER.indexOf(b.bot ?? ""));
    if (bots.length === 0) return;
    setHeld((current) => {
      const copy = new Set(current);
      for (const guess of bots) copy.add(chipKey(guess));
      return copy;
    });
    bots.forEach((guess, index) => {
      const id = window.setTimeout(() => {
        setHeld((current) => {
          if (!current.has(chipKey(guess))) return current;
          const copy = new Set(current);
        copy.delete(chipKey(guess));
        return copy;
      });
      setScrollTick((tick) => tick + 1);
    }, 520 + index * 560);
      revealTimers.current.push(id);
    });
  }

  async function start(replace: boolean) {
    clearReveal();
    setHeld(new Set());
    opened.current = false;
    setBusy(true);
    setNote("");
    try {
      const next = await call<{ game: GameView; stats: GameStats }>("/wordtron/games", {
        method: "POST",
        body: JSON.stringify({
          level: level || null,
          theme: theme || null,
          bots,
          replace,
        }),
      });
      setState((current) =>
        current ? { ...current, game: next.game, stats: next.stats } : current,
      );
      setConfirmNew(false);
      setStudied(false);
      setDraft("");
      setMisses([]);
    } catch (error) {
      const failed = error as CallError;
      if (failed.code === "unfinished") setConfirmNew(true);
      else setNote(visibleError(failed, "Не удалось начать игру."));
    } finally {
      setBusy(false);
    }
  }

  async function guess() {
    const word = draft.trim();
    if (!word) return;
    const previous = state?.game?.guesses ?? [];
    setBusy(true);
    setNote("");
    try {
      const next = await call<{ result: string; message: string; game: GameView; stats?: GameStats }>("/wordtron/guess", {
        method: "POST",
        body: JSON.stringify({ word }),
      });
      setState((current) =>
        current ? { ...current, game: next.game, stats: next.stats ?? current.stats } : current,
      );
      setScrollTick((tick) => tick + 1);
      if (next.result === "unknown" || next.result === "repeat") {
        const after = next.game.guesses.reduce((max, guess) => Math.max(max, guess.seq ?? 0), 0);
        missId.current += 1;
        const id = missId.current;
        setMisses((list) => [...list, { id, text: `${word.toUpperCase()} ${next.message.toUpperCase()}`, after: after + id / 1000 }]);
      } else {
        setDraft("");
        stageReveal(previous, next.game.guesses);
      }
    } catch (error) {
      setNote(visibleError(error));
    } finally {
      setBusy(false);
    }
  }

  async function hint(kind: string) {
    setBusy(true);
    setNote("");
    try {
      const next = await call<{ game: GameView; stats: GameStats }>("/wordtron/hint", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      setState((current) => (current ? { ...current, game: next.game, stats: next.stats } : current));
      setHintsOpen(false);
    } catch (error) {
      setNote(visibleError(error));
    } finally {
      setBusy(false);
    }
  }

  async function surrender() {
    setBusy(true);
    setNote("");
    try {
      const next = await call<{ game: GameView; stats: GameStats }>("/wordtron/surrender", { method: "POST" });
      setState((current) => (current ? { ...current, game: next.game, stats: next.stats } : current));
    } catch (error) {
      setNote(visibleError(error));
    } finally {
      setBusy(false);
    }
  }

  async function studyGuess(word: string) {
    setBusy(true);
    setNote("");
    try {
      const saved = await call<{ word: string; already: boolean }>("/wordtron/study", {
        method: "POST",
        body: JSON.stringify({ word }),
      });
      setState((current) => {
        if (!current?.game) return current;
        return {
          ...current,
          game: {
            ...current.game,
            guesses: current.game.guesses.map((guess) =>
              guess.word === saved.word ? { ...guess, studying: true } : guess,
            ),
          },
        };
      });
    } catch (error) {
      setNote(visibleError(error));
    } finally {
      setBusy(false);
    }
  }

  async function study(wordId: string) {
    setBusy(true);
    setNote("");
    try {
      await addStudyWord(wordId);
      setStudied(true);
    } catch (error) {
      setNote(visibleError(error));
    } finally {
      setBusy(false);
    }
  }

  function share(text: string) {
    const opened = openTelegramShare(window.location.origin, text);
    if (!opened) {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      setNote(text);
    }
  }

  const game = state?.game ?? null;
  const passport = game?.passport ?? null;
  const visibleGuesses = game?.guesses.filter((guess) => !held.has(chipKey(guess))) ?? [];
  const playing = game?.status === "playing";

  useEffect(() => {
    if (!playing || opened.current) return;
    if (visibleGuesses.length === 0 && misses.length === 0) return;
    opened.current = true;
    setScrollTick(1);
  }, [playing, visibleGuesses.length, misses.length]);

  return (
    <div className={playing ? "aside-game aside-live" : "aside-game"}>
      <ScreenHeader title="Wordtron" onBack={onBack} />
      {!state ? <p>Загрузка…</p> : null}
      {state && !state.available ? <p>Для этого языка игры нет.</p> : null}
      {note ? <p className="feedback">{note}</p> : null}

      {state?.available && !game ? (
        <form
          className="aside-setup"
          onSubmit={(event) => {
            event.preventDefault();
            void start(false);
          }}
        >
          <label>
            Уровень
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">Любой</option>
              {state.levels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тема
            <select value={theme} onChange={(event) => setTheme(event.target.value)}>
              <option value="">Любая</option>
              {state.themes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <ModePicker value={bots} onChange={setBots} />
          <button className="primary" type="submit" disabled={busy}>
            Новая игра
          </button>
        </form>
      ) : null}

      {game ? (
        <div className="aside-scroll" ref={scrollRef}>
          {game.opponents.length > 0 ? <p className="word-list-hint">С вами: {game.opponents.join(", ")}</p> : null}
          <p className="aside-score">
            Счёт {game.score}
            <span>
              попытки {game.attempts}, подсказки {game.hintCost}
            </span>
          </p>
          <HintBoard game={game} />
          <Board
            guesses={visibleGuesses}
            misses={misses}
            busy={busy}
            newestRef={newestRef}
            onStudy={(word) => void studyGuess(word)}
          />
          {passport ? (
            <section className="aside-passport">
              <h2>{passport.word}</h2>
              <p>{passport.translation}</p>
              <dl>
                <div>
                  <dt>Часть речи</dt>
                  <dd>{passport.posLabel}</dd>
                </div>
                {passport.transcription ? (
                  <div>
                    <dt>Транскрипция</dt>
                    <dd>{passport.transcription}</dd>
                  </div>
                ) : null}
                {passport.definition ? (
                  <div>
                    <dt>Значение</dt>
                    <dd>{passport.definition}</dd>
                  </div>
                ) : null}
                {passport.origin ? (
                  <div>
                    <dt>Происхождение</dt>
                    <dd>{passport.origin}</dd>
                  </div>
                ) : null}
              </dl>
              {passport.nearest.length > 0 ? (
                <ol className="aside-nearest">
                  {passport.nearest.map((item) => (
                    <li key={item.word}>
                      <span>{item.word}</span>
                      <em>{item.rank}</em>
                    </li>
                  ))}
                </ol>
              ) : null}
              <p className="aside-score">Счёт {game.score}</p>
              <div className="aside-actions">
                <button className="ghost" type="button" onClick={() => share(passport.shareText)}>
                  Поделиться
                </button>
                <button className="ghost" type="button" disabled={busy || studied} onClick={() => void study(passport.wordId)}>
                  {studied ? "Учу" : "Учить"}
                </button>
                <button className="primary" type="button" disabled={busy} onClick={() => void start(false)}>
                  Ещё игра
                </button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {playing && game ? (
        <div className="aside-dock">
          <ModePicker value={bots} onChange={setBots} />
          {hintsOpen ? (
            <div className="aside-hints">
              <button type="button" disabled={busy} onClick={() => void hint("closer")}>
                Ближе · {game.nextCloserCost}
              </button>
              <button type="button" disabled={busy || Boolean(game.hints.pos)} onClick={() => void hint("pos")}>
                Часть речи · 2
              </button>
              <button type="button" disabled={busy || Boolean(game.hints.theme)} onClick={() => void hint("theme")}>
                Тема · 3
              </button>
              <button type="button" disabled={busy || Boolean(game.hints.pattern)} onClick={() => void hint("letter")}>
                Первая буква · 5
              </button>
              <button type="button" disabled={busy || Boolean(game.hints.translation)} onClick={() => void hint("translation")}>
                Перевод · 10
              </button>
            </div>
          ) : null}
          {confirmNew ? (
            <div className="aside-confirm">
              <p>Текущая игра не закончена. Начать новую и заменить её?</p>
              <button className="primary" type="button" disabled={busy} onClick={() => void start(true)}>
                Да, заменить
              </button>
              <button className="ghost" type="button" onClick={() => setConfirmNew(false)}>
                Нет
              </button>
            </div>
          ) : null}
          <form
            className="aside-guess"
            onSubmit={(event) => {
              event.preventDefault();
              void guess();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Слово"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-label="Слово"
            />
            <button className="primary" type="submit" disabled={busy || !draft.trim()}>
              Проверить
            </button>
          </form>
          <div className="aside-play-actions">
            <button className="ghost" type="button" disabled={busy} onClick={() => setHintsOpen((open) => !open)}>
              Подсказка
            </button>
            <button className="ghost" type="button" disabled={busy} onClick={() => void surrender()}>
              Сдаться
            </button>
            <button className="ghost" type="button" disabled={busy} onClick={() => void start(false)}>
              Новая игра
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModePicker({ value, onChange }: { value: number; onChange: (bots: number) => void }) {
  const options = [
    { bots: 0, label: "Один" },
    { bots: 2, label: "2 бота" },
    { bots: 3, label: "3 бота" },
  ];
  return (
    <div className="aside-modes" role="group" aria-label="С кем играть">
      {options.map((option) => (
        <button
          key={option.bots}
          type="button"
          className={value === option.bots ? "on" : ""}
          aria-pressed={value === option.bots}
          onClick={() => onChange(option.bots)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function rankLabel(guess: GuessRow, compact: boolean): string {
  if (guess.far || guess.rank == null) return compact ? ">5000" : "далеко (>5000)";
  return String(guess.rank);
}

function barFill(guess: GuessRow): { width: string; background: string; color: string } {
  if (guess.far || guess.rank == null) {
    return { width: "34%", background: "#2a3142", color: "#f4f6fb" };
  }
  const rank = Math.min(Math.max(guess.rank, 1), 5000);
  const closeness = Math.log(rank) / Math.log(5000);
  const width = `${Math.round(100 - Math.pow(closeness, 1.2) * 62)}%`;
  if (rank <= 300) return { width, background: rank <= 80 ? "#2fce6a" : "#7dce45", color: "#14210f" };
  if (rank <= 1500) return { width, background: rank <= 700 ? "#c6c84a" : "#e0a322", color: "#1c1a0c" };
  return { width, background: rank <= 3000 ? "#e08a2a" : "#c56a22", color: "#1c140c" };
}

function playerTone(guess: GuessRow): { label: string; tone: string } {
  if (guess.bot === "mira") return { label: "Мира", tone: "mira" };
  if (guess.bot === "gleb") return { label: "Глеб", tone: "gleb" };
  if (guess.bot === "sonya") return { label: "Соня", tone: "sonya" };
  return { label: guess.botName ?? "Вы", tone: "you" };
}

function Board({
  guesses,
  misses,
  busy,
  newestRef,
  onStudy,
}: {
  guesses: GuessRow[];
  misses: { id: number; text: string; after: number }[];
  busy: boolean;
  newestRef: RefObject<HTMLLIElement | null>;
  onStudy: (word: string) => void;
}) {
  const feed = [
    ...guesses.map((guess) => ({ kind: "guess" as const, tick: guess.seq ?? 0, guess })),
    ...misses.map((miss) => ({ kind: "miss" as const, tick: miss.after, miss })),
  ].sort((a, b) => a.tick - b.tick);
  const ranked = [...guesses].sort((a, b) => {
    if (a.rank == null && b.rank == null) return a.word.localeCompare(b.word);
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return a.rank - b.rank;
  });
  if (feed.length === 0) return <p className="word-list-hint">Пока пусто. Напишите слово.</p>;
  return (
    <div className="aside-board-wrap">
      <div className="aside-board">
        <ol className="aside-feed">
          {feed.map((item, index) =>
            item.kind === "miss" ? (
              <li key={`miss-${item.miss.id}`} className="aside-miss" ref={index === feed.length - 1 ? newestRef : undefined}>
                {item.miss.text}
              </li>
            ) : (
              <li key={`feed-${item.guess.bot ?? "you"}-${item.guess.word}`} className="aside-line" ref={index === feed.length - 1 ? newestRef : undefined}>
                <GuessBar guess={item.guess} wideWhenFar />
                <StudyMark guess={item.guess} busy={busy} onStudy={onStudy} />
              </li>
            ),
          )}
        </ol>
        <ol className="aside-ranked">
          {ranked.map((guess) => {
            const player = playerTone(guess);
            return (
              <li key={`rank-${guess.bot ?? "you"}-${guess.word}`} className="aside-line">
                <GuessBar guess={guess} />
                <span className={`aside-who ${player.tone}`}>{player.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function GuessBar({ guess, wideWhenFar = false }: { guess: GuessRow; wideWhenFar?: boolean }) {
  const fill = barFill(guess);
  const far = guess.far || guess.rank == null;
  const width = far && wideWhenFar ? "100%" : far ? "58%" : fill.width;
  return (
    <div
      className={`aside-pill${far ? " far" : ""}`}
      style={{ ["--w" as string]: width, background: fill.background, color: fill.color }}
      title={far ? "далеко (>5000)" : undefined}
    >
      <b>
        {guess.hint ? <span aria-hidden>💡 </span> : null}
        {guess.word}
      </b>
      <em>{rankLabel(guess, !wideWhenFar)}</em>
    </div>
  );
}

function StudyMark({
  guess,
  busy,
  onStudy,
}: {
  guess: GuessRow;
  busy: boolean;
  onStudy: (word: string) => void;
}) {
  return (
    <button
      type="button"
      className="aside-study"
      disabled={busy || guess.studying}
      onClick={() => onStudy(guess.word)}
    >
      {guess.studying ? "Учу" : "Учить"}
    </button>
  );
}

function HintBoard({ game }: { game: GameView }) {
  const lines = [game.hints.pos, game.hints.theme, game.hints.pattern, game.hints.translation].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className="aside-revealed">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
