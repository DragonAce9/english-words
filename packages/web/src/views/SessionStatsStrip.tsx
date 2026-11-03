import { ruPlural } from "../ru";
import type { SessionLive } from "../useSessionProgress";

function accuracyLine(correct: number, wrong: number): string {
  return `${ruPlural(correct, "верный", "верных", "верных")} · ${ruPlural(wrong, "ошибка", "ошибки", "ошибок")}`;
}

export function SessionStatsStrip({ live }: { live: SessionLive }) {
  const answered = live.correct + live.wrong;
  const earned = live.coinsEarned.toLocaleString("ru-RU");
  const balance = live.balance === null ? null : live.balance.toLocaleString("ru-RU");
  const accuracy = accuracyLine(live.correct, live.wrong);
  const fresh = ruPlural(live.known, "новое слово", "новых слова", "новых слов");

  return (
    <div className="session-stats" aria-live="polite">
      <div
        className="session-stat coins"
        aria-label={
          balance === null
            ? `Моти, заработано ${earned}`
            : `Моти, заработано ${earned}, баланс ${balance}`
        }
      >
        <span className="session-stat-earn">Моти +{earned}</span>
        {balance !== null ? (
          <>
            <span className="session-stat-dot" aria-hidden>
              ·
            </span>
            <span className="session-stat-balance">баланс {balance}</span>
          </>
        ) : null}
      </div>
      <div className="session-stat accuracy" aria-label={`Точность сессии: ${accuracy}`}>
        <span className="stats-split session-split" aria-hidden>
          {answered === 0 ? (
            <i className="rest" style={{ flex: 1 }} />
          ) : (
            <>
              {live.correct > 0 ? <i className="ok" style={{ flex: live.correct }} /> : null}
              {live.wrong > 0 ? <i className="bad" style={{ flex: live.wrong }} /> : null}
            </>
          )}
        </span>
        <span>{accuracy}</span>
      </div>
      <div className="session-stat known" aria-label={`Новых слов в сессии: ${live.known}`}>
        <strong>{live.known.toLocaleString("ru-RU")}</strong>
        <span>{fresh.replace(/^\S+\s/, "")}</span>
      </div>
    </div>
  );
}
