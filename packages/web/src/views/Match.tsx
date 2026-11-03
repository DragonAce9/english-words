import { useEffect, useMemo, useState } from "react";
import { useSessionProgress } from "../useSessionProgress";
import type { MatchPair, SessionResponse } from "../types";
import { targetWord } from "../word";
import { Done } from "./Learn";
import { SessionExitBar } from "./SessionExitBar";
import { SessionStatsStrip } from "./SessionStatsStrip";
import { SpeakButton } from "./SpeakButton";

type Tile = { key: string; pairId: string; text: string; side: "en" | "ru" };

function tilesFor(round: MatchPair[]): Tile[] {
  const tiles = round.flatMap((pair) => [
    { key: `${pair.id}-en`, pairId: pair.id, text: targetWord(pair), side: "en" as const },
    { key: `${pair.id}-ru`, pairId: pair.id, text: pair.ru, side: "ru" as const },
  ]);
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export function Match({
  session,
  motiCoins = null,
  onDone,
}: {
  session: SessionResponse;
  motiCoins?: number | null;
  onDone: () => void;
}) {
  const rounds = session.matchRounds;
  const [roundIndex, setRoundIndex] = useState(0);
  const [tiles, setTiles] = useState(() => tilesFor(rounds[0] ?? []));
  const [selected, setSelected] = useState<Tile | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [missKey, setMissKey] = useState<string | null>(null);
  const [errors, setErrors] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [finished, setFinished] = useState(false);
  const { bump, flush, live } = useSessionProgress(session.themeId, session.words, motiCoins);
  const round = rounds[roundIndex];

  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [finished]);

  const remaining = useMemo(
    () => tiles.filter((tile) => !matched.has(tile.key)).length,
    [tiles, matched],
  );

  function nextRound() {
    const next = roundIndex + 1;
    if (next >= rounds.length) {
      setFinished(true);
      return;
    }
    setRoundIndex(next);
    setTiles(tilesFor(rounds[next]));
    setSelected(null);
    setMatched(new Set());
  }

  function onTile(tile: Tile) {
    if (matched.has(tile.key) || missKey) return;
    if (!selected) {
      setSelected(tile);
      return;
    }
    if (selected.key === tile.key) {
      setSelected(null);
      return;
    }
    if (selected.side === tile.side) {
      setSelected(tile);
      return;
    }
    if (selected.pairId === tile.pairId) {
      bump(tile.pairId, { correct: 1 });
      const next = new Set(matched);
      next.add(selected.key);
      next.add(tile.key);
      setMatched(next);
      setSelected(null);
      if (next.size === tiles.length) window.setTimeout(nextRound, 400);
      return;
    }
    bump(selected.pairId, { wrong: 1 });
    bump(tile.pairId, { wrong: 1 });
    setErrors((value) => value + 1);
    setMissKey(tile.key);
    window.setTimeout(() => {
      setSelected(null);
      setMissKey(null);
    }, 450);
  }

  if (finished || !round) {
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return (
      <Done
        title={`${mm}:${ss}`}
        hint={`Ошибок: ${errors}`}
        onExit={async () => {
          await flush();
          onDone();
        }}
      />
    );
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <>
      <SessionExitBar flush={flush} onDone={onDone} extra={<SessionStatsStrip live={live} />}>
        <p className="progress">
          Раунд {roundIndex + 1}/{rounds.length} · {mm}:{ss} · ошибок {errors}
        </p>
      </SessionExitBar>
      <div className="grid">
        {tiles.map((tile) => (
          <div key={tile.key} className="tile-wrap">
            <button
              className={`tile ${matched.has(tile.key) ? "matched" : ""} ${selected?.key === tile.key ? "selected" : ""} ${
                missKey && (tile.key === missKey || tile.key === selected?.key) ? "miss" : ""
              }`}
              onClick={() => onTile(tile)}
            >
              {tile.text}
            </button>
            {tile.side === "en" && !matched.has(tile.key) ? (
              <SpeakButton className="tile-speak" text={tile.text} />
            ) : null}
          </div>
        ))}
      </div>
      <p className="progress">Осталось пар: {remaining / 2}</p>
    </>
  );
}
