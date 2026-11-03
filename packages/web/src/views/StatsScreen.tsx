import { Component, type ReactNode, useEffect, useState } from "react";
import { loadStats } from "../api";
import { ruPlural } from "../ru";
import type { CefrLevel, UserStats } from "../types";
import { ScreenHeader } from "./ScreenHeader";

const STATS_ERROR = "Не удалось показать успех.";

const GOAL_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500];

const LEVEL_TITLES: Record<CefrLevel, string> = {
  A1: "Начальный",
  A2: "Базовый",
  B1: "Средний",
  B2: "Выше среднего",
  C1: "Продвинутый",
  C2: "Свободный",
};

function wordForm(count: number): string {
  return ruPlural(count, "слово", "слова", "слов").replace(/^\S+\s/, "");
}

function goalFor(known: number, total: number) {
  const steps = [...GOAL_STEPS.filter((step) => step < total), total].filter(
    (step, index, all) => all.indexOf(step) === index && step > 0,
  );
  const next = steps.find((step) => step > known) ?? total;
  const prev = [...steps].reverse().find((step) => step <= known) ?? 0;
  const span = Math.max(1, next - prev);
  const percent = total > 0 && known >= total ? 100 : Math.min(100, Math.round(((known - prev) / span) * 100));
  return { prev, next, percent, left: Math.max(0, next - known) };
}

function nearbyGoals(known: number, total: number): number[] {
  const steps = GOAL_STEPS.filter((step) => step < total);
  if (steps.length === 0) return total > 0 ? [total] : [];
  let index = steps.findIndex((step) => step > known);
  if (index === -1) index = steps.length - 1;
  return steps.slice(Math.max(0, index - 1), Math.max(0, index - 1) + 4);
}

function goalLine(known: number, total: number, left: number, next: number): string {
  if (total > 0 && known >= total) return "Каталог закрыт.";
  if (known === 0) return "Первые 10 слов — ближайшая отметка.";
  return `Ещё ${ruPlural(left, "слово", "слова", "слов")} до ${next.toLocaleString("ru-RU")}`;
}

function isCompleteStats(value: unknown): value is UserStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as UserStats;
  const numbers = [stats.known, stats.examined, stats.total, stats.learning, stats.correct, stats.wrong, stats.coins, stats.streak];
  if (numbers.some((item) => typeof item !== "number" || Number.isNaN(item))) return false;
  if (stats.accuracy !== null && (typeof stats.accuracy !== "number" || Number.isNaN(stats.accuracy))) return false;
  if (!Array.isArray(stats.week) || !Array.isArray(stats.levels) || !Array.isArray(stats.themes)) return false;
  if (stats.week.some((day) => !day || typeof day.day !== "string" || typeof day.count !== "number" || Number.isNaN(day.count))) {
    return false;
  }
  if (stats.levels.some((level) => !level || typeof level.level !== "string" || typeof level.known !== "number")) return false;
  if (
    stats.themes.some(
      (theme) =>
        !theme ||
        typeof theme.id !== "string" ||
        typeof theme.title !== "string" ||
        typeof theme.known !== "number" ||
        typeof theme.total !== "number" ||
        Number.isNaN(theme.total),
    )
  ) {
    return false;
  }
  return true;
}

class StatsErrorBoundary extends Component<{ onBack: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <StatsUnavailable onBack={this.props.onBack} />;
    return this.props.children;
  }
}

function StatsUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <div className="stats">
      <ScreenHeader title="Достижения" onBack={onBack} />
      <p className="feedback bad">{STATS_ERROR}</p>
    </div>
  );
}

export function StatsScreen({ onBack, extra }: { onBack: () => void; extra?: ReactNode }) {
  return (
    <StatsErrorBoundary onBack={onBack}>
      <StatsLoader onBack={onBack} extra={extra} />
    </StatsErrorBoundary>
  );
}

function StatsLoader({ onBack, extra }: { onBack: () => void; extra?: ReactNode }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    loadStats()
      .then((next) => {
        if (!alive) return;
        if (!isCompleteStats(next)) {
          setError(STATS_ERROR);
          return;
        }
        setStats(next);
      })
      .catch(() => {
        if (alive) setError(STATS_ERROR);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="stats">
      <ScreenHeader title="Достижения" onBack={onBack} />

      {error ? <p className="feedback bad">{error}</p> : null}
      {!stats && !error ? <p>Считаем успех…</p> : null}
      {stats && !error ? <StatsBody stats={stats} extra={extra} /> : null}
    </div>
  );
}

function StatsBody({ stats, extra }: { stats: UserStats; extra?: ReactNode }) {
  const goal = goalFor(stats.known, stats.total);
  const marks = nearbyGoals(stats.known, stats.total);
  const answered = stats.correct + stats.wrong;
  const knownLevels = stats.levels.filter((level) => level.known > 0);
  const nextLevel = stats.levels.find((level) => level.known === 0);
  const weekTotal = stats.week.reduce((sum, day) => sum + day.count, 0);
  const best = stats.week.reduce((top, day) => (day.count > top.count ? day : top), stats.week[0]!);

  return (
    <>
      <section className="stats-hero">
        <div
          className="stats-ring"
          style={{ ["--p" as string]: String(goal.percent) }}
          role="img"
          aria-label={goalLine(stats.known, stats.total, goal.left, goal.next)}
        >
          <div className="stats-ring-core">
            <strong>{stats.known.toLocaleString("ru-RU")}</strong>
            <span>{wordForm(stats.known)}</span>
          </div>
        </div>
        <p className="stats-goal">{goalLine(stats.known, stats.total, goal.left, goal.next)}</p>
        {marks.length > 0 ? (
          <ol className="stats-marks">
            {marks.map((mark) => (
              <li key={mark} className={stats.known >= mark ? "done" : mark === goal.next ? "next" : ""}>
                <span />
                <em>{mark.toLocaleString("ru-RU")}</em>
              </li>
            ))}
          </ol>
        ) : null}
        {stats.learning > 0 ? (
          <span className="stats-chip">
            В работе {ruPlural(stats.learning, "слово", "слова", "слов")}
          </span>
        ) : null}
      </section>
      {extra}

      <section className="stats-exam">
        <div className="stats-exam-count">
          <strong>{stats.examined.toLocaleString("ru-RU")}</strong>
          <span>{wordForm(stats.examined)}</span>
        </div>
        <p>
          {stats.examined === 0
            ? "Экзамен ещё не подтвердил ни одного слова. Слово попадает сюда, когда перевод в обе стороны верный."
            : "Экзамен подтвердил эти слова: перевод в обе стороны был верным."}
        </p>
      </section>

      <section className="stats-accuracy">
        <div
          className="stats-mini-ring"
          style={{ ["--p" as string]: String(stats.accuracy ?? 0) }}
          role="img"
          aria-label={stats.accuracy === null ? "Точности ещё нет" : `Точность ${stats.accuracy}%`}
        >
          <strong>{stats.accuracy === null ? "—" : `${stats.accuracy}%`}</strong>
        </div>
        <div className="stats-accuracy-copy">
          <span>Точность</span>
          <div className="stats-split" aria-hidden>
            {answered === 0 ? (
              <i className="rest" style={{ flex: 1 }} />
            ) : (
              <>
                <i className="ok" style={{ flex: Math.max(stats.correct, 0.001) }} />
                {stats.wrong > 0 ? <i className="bad" style={{ flex: stats.wrong }} /> : null}
              </>
            )}
          </div>
          <em>
            {answered === 0
              ? "Появится после первого ответа"
              : `${ruPlural(stats.correct, "верный", "верных", "верных")} · ${ruPlural(stats.wrong, "ошибка", "ошибки", "ошибок")}`}
          </em>
        </div>
      </section>

      <div className="stats-pair">
        <article className="stats-pair-card streak">
          <span>Серия</span>
          <strong>{stats.streak}</strong>
          <em>{ruPlural(stats.streak, "день подряд", "дня подряд", "дней подряд").replace(/^\S+\s/, "")}</em>
        </article>
        <article className="stats-pair-card coins">
          <span>Монеты</span>
          <strong>{stats.coins.toLocaleString("ru-RU")}</strong>
          <em>у Моти</em>
        </article>
      </div>

      <section className="stats-panel">
        <div className="stats-panel-head">
          <h2>Эта неделя</h2>
          <em>
            {weekTotal === 0
              ? "Ждёт первое слово"
              : ruPlural(weekTotal, "слово", "слова", "слов")}
          </em>
        </div>
        <div className="stats-days">
          {stats.week.map((day, index) => (
            <div
              key={day.day}
              className={`stats-day${day.count > 0 ? " on" : ""}${index === stats.week.length - 1 ? " today" : ""}`}
            >
              <span>{day.count > 0 ? day.count : ""}</span>
              <em>{day.label}</em>
            </div>
          ))}
        </div>
        {best && best.count > 0 ? (
          <p className="stats-note">
            Лучший день — {best.label}, {ruPlural(best.count, "слово", "слова", "слов")}
          </p>
        ) : null}
      </section>

      <section className="stats-panel">
        <div className="stats-panel-head">
          <h2>Твои слова</h2>
          <em>{knownLevels.length === 0 ? "Пока пусто" : ruPlural(stats.known, "слово", "слова", "слов")}</em>
        </div>
        {knownLevels.length === 0 ? (
          <p className="stats-note">Отметь первое слово — здесь появится состав по уровням.</p>
        ) : (
          <>
            <div className="stats-mix" aria-hidden>
              {knownLevels.map((level) => (
                <span
                  key={level.level}
                  className={`lv-${level.level}`}
                  style={{ flex: level.known }}
                />
              ))}
            </div>
            <ul className="stats-legend">
              {knownLevels.map((level) => (
                <li key={level.level}>
                  <i className={`lv-${level.level}`} />
                  <strong>{level.level}</strong>
                  <span>{LEVEL_TITLES[level.level]}</span>
                  <em>{level.known}</em>
                </li>
              ))}
            </ul>
            {nextLevel ? <p className="stats-note">Дальше открывается {nextLevel.level}</p> : null}
          </>
        )}
      </section>

      <section className="stats-panel">
        <div className="stats-panel-head">
          <h2>Темы</h2>
          <em>{stats.themes.length === 0 ? "Пока нет" : String(stats.themes.length)}</em>
        </div>
        {stats.themes.length === 0 ? (
          <p className="stats-note">Тема появится вместе с первым выученным словом.</p>
        ) : (
          <div className="stats-theme-list">
            {stats.themes.map((theme) => (
              <article key={theme.id} className="stats-theme-card">
                <strong>{theme.known}</strong>
                <div>
                  <b>{theme.title}</b>
                  <em>из {theme.total.toLocaleString("ru-RU")}</em>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
