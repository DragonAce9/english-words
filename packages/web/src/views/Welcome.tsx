import { useState } from "react";
import type { LegalDoc } from "../legal";
import type { GuideTry, PetSnapshot } from "../types";
import { LegalConsent } from "./LegalLinks";
import { Moti } from "./Moti";

const STEP_KEY = "welcome_step";

const idleMoti: PetSnapshot = {
  coins: 0,
  hunger: 82,
  mood: 84,
  home: 70,
  study: 55,
  status: "alive",
  lastTickAt: new Date(0).toISOString(),
  sufferingStartedAt: null,
  cryoAt: null,
  graduatedAt: null,
  knownCount: 0,
  totalWords: 0,
  actionCost: 10,
  coinsPerKnownWord: 8,
  coinsPerInvite: 50,
};

type Point = { title: string; text: string };
type Step = {
  id: string;
  kicker: string;
  title: string;
  lead: string;
  moti?: boolean;
  points?: Point[];
  tryId?: GuideTry;
  tryLabel?: string;
};

const STEPS: Step[] = [
  {
    id: "why",
    kicker: "Зачем Моти",
    title: "Учишь слова — и Моти живёт",
    lead: "Новое слово даёт монеты. Ими кормишь и развлекаешь Моти.",
    moti: true,
    points: [
      { title: `${idleMoti.coinsPerKnownWord} монет`, text: "за каждое новое слово, которое отметил как выученное" },
      { title: `${idleMoti.actionCost} монет`, text: "стоит покормить или развлечь" },
    ],
    tryId: "moti",
    tryLabel: "Попробовать с Моти",
  },
  {
    id: "study",
    kicker: "Как учить",
    title: "Три упражнения на одни слова",
    lead: "В теме открываешь набор и проходишь его так, как удобно сейчас.",
    points: [
      { title: "Карточки", text: "смотришь слово и перевод, потом листаешь дальше" },
      { title: "Пары", text: "соединяешь английское слово с русским" },
      { title: "Тест", text: "выбираешь ответ и видишь, что запомнил" },
      { title: "Уже знаю", text: "знакомое слово отмечаешь и больше его не учишь" },
    ],
    tryId: "study",
    tryLabel: "Попробовать упражнения",
  },
  {
    id: "sources",
    kicker: "Откуда слова",
    title: "Берёшь то, что близко",
    lead: "Готовые темы, кино, свой текст или поиск в словаре.",
    points: [
      { title: "Темы", text: "подборки вроде чисел, еды и путешествий. Десять базовых — бесплатно" },
      { title: "Кино и сериалы", text: "слова из фильма. Один фильм или сериал можно выбрать бесплатно" },
      { title: "Свой текст", text: "статья или заметка: разберём слова и подскажем, что учить" },
      {
        title: "Словарь",
        text: "Ищешь слово и добавляешь карточку в учёбу",
      },
    ],
    tryId: "words",
    tryLabel: "Попробовать словарь",
  },
  {
    id: "path",
    kicker: "Твой путь",
    title: "Видно, что уже получается",
    lead: "Прогресс копится сам, пока ты учишь.",
    points: [
      { title: "Изучаю", text: "темы и фильмы, которые ты взял в работу" },
      { title: "Достижения", text: "сколько слов выучено, точность ответов и серия дней" },
      { title: "Друг", text: "когда друг закончит первое занятие, ты выберешь фильм, сериал или тему" },
      { title: "Преподаватели", text: "можно написать в Telegram" },
    ],
    tryId: "path",
    tryLabel: "Попробовать успех",
  },
  {
    id: "start",
    kicker: "Старт",
    title: "Можно начать бесплатно",
    lead: "10 тем, один свой текст и один фильм или сериал. Остальное — по подписке.",
    moti: true,
  },
];

function readStep(): number {
  try {
    const value = Number(window.sessionStorage.getItem(STEP_KEY));
    if (Number.isInteger(value) && value >= 0 && value < STEPS.length) return value;
  } catch {
    /* private mode */
  }
  return 0;
}

function storeStep(index: number): void {
  try {
    window.sessionStorage.setItem(STEP_KEY, String(index));
  } catch {
    /* private mode */
  }
}

export function resetWelcomeStep(): void {
  try {
    window.sessionStorage.removeItem(STEP_KEY);
  } catch {
    /* private mode */
  }
}

export function Welcome({
  busy,
  replay,
  onStart,
  onWords,
  onSkip,
  onTry,
  onOpenLegal,
}: {
  busy?: boolean;
  replay?: boolean;
  onStart: () => void;
  onWords: () => void;
  onSkip: () => void;
  onTry: (id: GuideTry) => void;
  onOpenLegal: (doc: LegalDoc) => void;
}) {
  const [index, setIndex] = useState(readStep);
  const step = STEPS[index] ?? STEPS[0];
  const last = index === STEPS.length - 1;
  const progress = Math.round(((index + 1) / STEPS.length) * 100);

  function go(next: number) {
    const clamped = Math.min(STEPS.length - 1, Math.max(0, next));
    storeStep(clamped);
    setIndex(clamped);
  }

  function leave(action: () => void) {
    try {
      window.sessionStorage.removeItem(STEP_KEY);
    } catch {
      /* private mode */
    }
    action();
  }

  return (
    <div className="welcome">
      <header className="welcome-top">
        <p>
          Шаг {index + 1} из {STEPS.length}
        </p>
        <button type="button" className="welcome-skip" disabled={busy} onClick={() => leave(onSkip)}>
          {replay ? "Закрыть" : "Пропустить"}
        </button>
      </header>
      <div
        className="welcome-track"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={index + 1}
        aria-label="Знакомство с Моти"
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="welcome-body" key={step.id}>
        {step.moti ? <Moti pet={idleMoti} acting={null} actKey={0} /> : null}
        <p className="welcome-kicker">{step.kicker}</p>
        <h1>{step.title}</h1>
        <p className="welcome-lead">{step.lead}</p>
        {step.points ? (
          <div className="welcome-grid">
            {step.points.map((point) => (
              <article key={point.title} className="welcome-point">
                <strong>{point.title}</strong>
                <span>{point.text}</span>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="welcome-actions">
        {last ? (
          <>
            <div className="welcome-nav has-back">
              <button type="button" className="ghost" disabled={busy} onClick={() => go(index - 1)}>
                Назад
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => leave(onStart)}>
                {replay ? "Готово" : "Начать"}
              </button>
            </div>
            <button type="button" className="ghost" disabled={busy} onClick={() => leave(onWords)}>
              К словам
            </button>
            <LegalConsent onOpen={onOpenLegal} className="welcome-legal" />
          </>
        ) : (
          <>
            <div className={`welcome-nav${index > 0 ? " has-back" : ""}`}>
              {index > 0 ? (
                <button type="button" className="ghost" disabled={busy} onClick={() => go(index - 1)}>
                  Назад
                </button>
              ) : null}
              <button type="button" className="primary" disabled={busy} onClick={() => go(index + 1)}>
                Дальше
              </button>
            </div>
            {step.tryId && step.tryLabel ? (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => leave(() => onTry(step.tryId as GuideTry))}
              >
                {step.tryLabel}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
