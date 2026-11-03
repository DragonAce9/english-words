import { useEffect, useRef, useState } from "react";
import type { DailyFact, PetAction, PetSnapshot } from "../types";
import { openMotiChannel } from "../telegram";
import { Moti, MOTI_ACTION_MS, MOTI_REACTION_MS, motiBarsLow, type MotiReaction } from "./Moti";

const actions: { id: PetAction; title: string; hint: string }[] = [
  { id: "feed", title: "Кормить", hint: "сытость" },
  { id: "play", title: "Развлечь", hint: "настроение" },
];

const bars: { key: "hunger" | "mood"; label: string }[] = [
  { key: "hunger", label: "Сытость" },
  { key: "mood", label: "Настроение" },
];

const FACT_TITLE = "Интересный факт от Моти";

function factFoldKey(day: string): string {
  return `moti-fact-fold:${day}`;
}

/** Closed until this device opens today's fact. Older "1" values stay closed. */
function readFactFolded(day: string): boolean {
  try {
    return localStorage.getItem(factFoldKey(day)) !== "open";
  } catch {
    return true;
  }
}

export function PetHome({
  pet,
  fact,
  coinsFlash,
  rescued,
  rescuePlay,
  busy,
  onAction,
  onCoinsSeen,
  onRescueSeen,
}: {
  pet: PetSnapshot;
  fact: DailyFact | null;
  coinsFlash: number;
  rescued: boolean;
  rescuePlay?: boolean;
  busy?: boolean;
  onAction: (action: PetAction) => void;
  onCoinsSeen?: () => void;
  onRescueSeen?: () => void;
}) {
  const frozen = pet.status === "cryo" || pet.status === "graduated";
  const canSpend = !frozen && pet.coins >= pet.actionCost && !busy;
  const broke = pet.coins < pet.actionCost;
  const reallySuffering = pet.status === "suffering" && motiBarsLow(pet);
  const showBrokeHint = !frozen && broke && !reallySuffering;
  const showAliveHint = pet.status === "alive" && !broke;
  const [acting, setActing] = useState<PetAction | null>(null);
  const [actKey, setActKey] = useState(0);
  const [reaction, setReaction] = useState<MotiReaction | null>(null);
  const [reactKey, setReactKey] = useState(0);
  const [factFolded, setFactFolded] = useState(() => (fact ? readFactFolded(fact.day) : true));
  const onCoinsSeenRef = useRef(onCoinsSeen);
  const onRescueSeenRef = useRef(onRescueSeen);
  onCoinsSeenRef.current = onCoinsSeen;
  onRescueSeenRef.current = onRescueSeen;

  useEffect(() => {
    if (!acting) return;
    const timer = window.setTimeout(() => setActing(null), MOTI_ACTION_MS);
    return () => window.clearTimeout(timer);
  }, [acting, actKey]);

  // Play each burst once, then tell App to clear the trigger so remounts do not replay.
  // Rescue wins over coins: after thaw, coins still fire if coinsFlash is waiting.
  useEffect(() => {
    if (!rescuePlay) return;
    setReaction("rescued");
    setReactKey((key) => key + 1);
    const play = window.setTimeout(() => setReaction(null), MOTI_REACTION_MS.rescued);
    const seen = window.setTimeout(() => onRescueSeenRef.current?.(), MOTI_REACTION_MS.rescued);
    return () => {
      window.clearTimeout(play);
      window.clearTimeout(seen);
    };
  }, [rescuePlay]);

  useEffect(() => {
    if (rescuePlay || coinsFlash <= 0) return;
    setReaction("coins");
    setReactKey((key) => key + 1);
    const play = window.setTimeout(() => setReaction(null), MOTI_REACTION_MS.coins);
    const seen = window.setTimeout(() => onCoinsSeenRef.current?.(), MOTI_REACTION_MS.coins);
    return () => {
      window.clearTimeout(play);
      window.clearTimeout(seen);
    };
  }, [coinsFlash, rescuePlay]);

  useEffect(() => {
    setFactFolded(fact ? readFactFolded(fact.day) : true);
  }, [fact?.day]);

  function foldFact() {
    if (!fact) return;
    try {
      localStorage.removeItem(factFoldKey(fact.day));
    } catch {
      /* private mode still folds for this visit */
    }
    setFactFolded(true);
  }

  function unfoldFact() {
    if (!fact) return;
    try {
      localStorage.setItem(factFoldKey(fact.day), "open");
    } catch {
      /* private mode still opens for this visit */
    }
    setFactFolded(false);
  }

  function playAction(id: PetAction) {
    setActing(id);
    setActKey((key) => key + 1);
    onAction(id);
  }

  return (
    <div className="pet-home">
      <div className="moti-split">
        <div className="moti-scene">
          <Moti pet={pet} acting={acting} actKey={actKey} reaction={reaction} reactKey={reactKey} />
        </div>
        <div className="moti-needs">
          <div className="moti-head">
            <h1>Моти</h1>
            <span className="coin-pill" aria-label={`${pet.coins} монет`}>
              {pet.coins} монет
            </span>
          </div>
          {pet.status !== "graduated" && pet.status !== "cryo" ? (
            <div className="need-list">
              {bars.map((bar) => (
                <div key={bar.key} className="need">
                  <div className="row">
                    <span>{bar.label}</span>
                    <span>{pet[bar.key]}</span>
                  </div>
                  <div className="bar" aria-hidden>
                    <span style={{ width: `${pet[bar.key]}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <button type="button" className="moti-channel" onClick={openMotiChannel}>
            <span>Канал Моти</span>
            <em>Подписаться</em>
          </button>
        </div>
      </div>
      {coinsFlash > 0 ? <p className="feedback ok">+{coinsFlash} монет за новые слова</p> : null}

      {fact && !factFolded ? (
        <section className="moti-fact" aria-label={FACT_TITLE}>
          <p className="moti-fact-title">{FACT_TITLE}</p>
          <p>{fact.body}</p>
          <button type="button" className="moti-fact-fold" onClick={foldFact}>
            Свернуть
          </button>
        </section>
      ) : null}
      {fact && factFolded ? (
        <button type="button" className="moti-fact-row" aria-expanded={false} onClick={unfoldFact}>
          {FACT_TITLE}
        </button>
      ) : null}

      {showAliveHint ? (
        <p>
          Новое выученное слово — {pet.coinsPerKnownWord} монет. Кормить и развлечь стоит {pet.actionCost}.
        </p>
      ) : null}
      {reallySuffering ? (
        <div className="banner warn">
          Моти страдает: монеты кончились. Выучи слова за несколько дней, иначе он уйдёт в криокапсулу.
        </div>
      ) : null}
      {showBrokeHint ? (
        <div className="banner warn">
          Монеты кончились. Выучи слова — появятся монеты, ими можно кормить и развлекать.
        </div>
      ) : null}
      {rescued && pet.status === "alive" ? (
        <div className="banner ok">Ты спас его! Моти снова с тобой и верит, что ты рядом.</div>
      ) : null}
      {pet.status === "cryo" ? (
        <div className="cryo-note">
          Я ушёл в криокапсулу. Мне холодно и страшно, но я верю: ты вернёшься и спасёшь меня. Я буду ждать.
        </div>
      ) : null}
      {pet.status === "graduated" ? (
        <div className="banner ok ending">
          <strong>Тамагочи пройден.</strong>
          <p>
            Моти уехал учиться и работать в другой город. Он пишет, что хочет завести семью. Словарь по-прежнему с
            тобой.
          </p>
        </div>
      ) : null}

      <div className="actions-grid">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="mode-card"
            disabled={!canSpend}
            onClick={() => playAction(action.id)}
          >
            <strong>{action.title}</strong>
            <p>
              {pet.actionCost} монет · {action.hint}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
