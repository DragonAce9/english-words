import { useState, type ReactNode } from "react";
import type { LegalDoc } from "../legal";
import { guideStepDone, practiceTheme } from "../guide";
import { catalogShareLabel, ruPlural } from "../ru";
import { groupMediaThemes } from "../mediaGroup";
import type { DailyFact, GuideTry, PetAction, PetSnapshot, ReferralSummary, ThemeBlockSummary, ThemeSummary } from "../types";
import { HomeScreenButton } from "./HomeScreenButton";
import { InviteFriend } from "./InviteFriend";
import { LegalConsent } from "./LegalLinks";
import { PetHome } from "./PetHome";
import { ThemeOutlineList } from "./ThemeList";
import { VoiceRow } from "./VoicePick";

const HOME_WORD_BLOCKS = 2;
const HOME_THEMES_PER_BLOCK = 3;
const HOME_MEDIA = 8;

const GUIDE_ROWS: {
  id: GuideTry;
  title: string;
  praise: string;
  ahead: string;
}[] = [
  { id: "moti", title: "Моти", praise: "Молодец, ты позаботился о Моти", ahead: "Покорми или развлеки" },
  { id: "study", title: "Упражнения", praise: "Молодец, ты уже учил слова", ahead: "Начни карточки, пары или тест" },
  { id: "words", title: "Откуда слова", praise: "Молодец, ты открыл источник слов", ahead: "Словарь, кино или свой текст" },
  { id: "path", title: "Твой путь", praise: "Молодец, ты посмотрел прогресс", ahead: "Открой успех или «Изучаю»" },
];

/** Survives leaving home (the screen unmounts) and resets when the app loads. */
let sessionGuideExpanded: boolean | undefined;

/** Fresh load: two or more open tasks start expanded; one or none start collapsed. */
function guideStartsOpen(left: number) {
  return left >= 2;
}

export function HomeFeed({
  pet,
  referral,
  fact,
  coinsFlash,
  rescued,
  rescuePlay,
  busy,
  subscribed,
  blocks,
  themes,
  onAction,
  onTeachers,
  onOpenTheme,
  onOpenMedia,
  onOpenWords,
  onOpenTexts,
  onOpenStudying,
  onOpenStats,
  onOpenDictionary,
  onOpenGuide,
  onOpenReferral,
  guideTries,
  onCoinsSeen,
  onRescueSeen,
  analyzing,
  analyzeReady,
  onOpenLegal,
  showDictionary = true,
  showTexts = true,
  voiceLang = "en-US",
  onOpenVoice,
  extra,
}: {
  pet: PetSnapshot;
  referral: ReferralSummary;
  fact: DailyFact | null;
  coinsFlash: number;
  rescued: boolean;
  rescuePlay?: boolean;
  busy?: boolean;
  subscribed: boolean;
  blocks: ThemeBlockSummary[];
  themes: ThemeSummary[];
  onAction: (action: PetAction) => void;
  onTeachers: () => void;
  onOpenTheme: (theme: ThemeSummary) => void;
  onOpenMedia: () => void;
  onOpenWords: () => void;
  onOpenTexts: () => void;
  onOpenStudying: () => void;
  onOpenStats: () => void;
  onOpenDictionary: () => void;
  onOpenGuide: () => void;
  onOpenReferral: () => void;
  guideTries: string[];
  onCoinsSeen?: () => void;
  onRescueSeen?: () => void;
  analyzing?: boolean;
  analyzeReady?: boolean;
  onOpenLegal: (doc: LegalDoc) => void;
  showDictionary?: boolean;
  showTexts?: boolean;
  voiceLang?: string;
  onOpenVoice?: () => void;
  extra?: ReactNode;
}) {
  const media = groupMediaThemes(blocks.find((block) => block.id === "media")?.themes ?? []).slice(
    0,
    HOME_MEDIA,
  );
  const wordBlocks = blocks
    .filter((block) => block.id !== "media" && block.themes.length > 0)
    .slice(0, HOME_WORD_BLOCKS);
  const studying = themes.filter((theme) => theme.studying);
  const studyingKnown = studying.reduce((sum, theme) => sum + theme.knownCount, 0);
  const studyingTotal = studying.reduce((sum, theme) => sum + theme.wordCount, 0);
  const studyingPercent = studyingTotal === 0 ? 0 : Math.round((studyingKnown / studyingTotal) * 100);
  function stepDone(id: (typeof GUIDE_ROWS)[number]["id"]) {
    return guideStepDone(id, guideTries, pet, themes);
  }
  const guideDone = GUIDE_ROWS.filter((row) => stepDone(row.id)).length;
  const guideLeft = GUIDE_ROWS.length - guideDone;
  const guideComplete = guideLeft === 0;
  const remaining = guideLeft === 1 ? GUIDE_ROWS.find((row) => !stepDone(row.id)) : undefined;
  const [expanded, setExpanded] = useState(() => sessionGuideExpanded ?? guideStartsOpen(guideLeft));

  function toggleExpanded() {
    setExpanded((value) => {
      const next = !value;
      sessionGuideExpanded = next;
      return next;
    });
  }

  function openGuideRow(id: GuideTry) {
    if (id === "moti") {
      document.querySelector(".pet-home")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (id === "study") {
      const theme = practiceTheme(themes);
      if (theme) onOpenTheme(theme);
      else onOpenWords();
      return;
    }
    if (id === "words") {
      if (showDictionary) onOpenDictionary();
      else onOpenWords();
      return;
    }
    onOpenStats();
  }

  return (
    <div className="home-feed">
      <PetHome
        pet={pet}
        fact={fact}
        coinsFlash={coinsFlash}
        rescued={rescued}
        rescuePlay={rescuePlay}
        busy={busy}
        onAction={onAction}
        onCoinsSeen={onCoinsSeen}
        onRescueSeen={onRescueSeen}
      />

      <section
        className={`guide-progress${guideComplete ? " done" : ""}${expanded ? " open" : ""}${!expanded && remaining ? " one" : ""}`}
        aria-label="Первые шаги"
      >
        {!expanded && remaining ? (
          <div className="guide-one">
            <span className="guide-one-spacer" aria-hidden>
              Первые шаги
            </span>
            <button type="button" className="guide-one-task" onClick={() => openGuideRow(remaining.id)}>
              <strong>{remaining.title}</strong>
              <em>{remaining.ahead}</em>
            </button>
            <button type="button" className="guide-one-open" aria-expanded={false} onClick={toggleExpanded}>
              <span className="guide-one-label">Первые шаги</span>
              <span className="guide-chevron" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="guide-toggle" aria-expanded={expanded} onClick={toggleExpanded}>
              <h2>Первые шаги</h2>
              <span>
                {guideComplete ? "Всё получилось" : `${guideDone} из ${GUIDE_ROWS.length}`}
                <span className="guide-chevron" aria-hidden />
              </span>
            </button>
            {expanded
              ? GUIDE_ROWS.map((row) => {
                  const done = stepDone(row.id);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={done ? "guide-step done" : "guide-step"}
                      onClick={() => openGuideRow(row.id)}
                    >
                      <span className="guide-mark" aria-hidden>
                        {done ? "✓" : ""}
                      </span>
                      <span>
                        <strong>{row.title}</strong>
                        <em>{done ? row.praise : row.ahead}</em>
                      </span>
                    </button>
                  );
                })
              : null}
          </>
        )}
      </section>

      <section className="home-tools" aria-label="Разделы">
        <button type="button" className="home-tool tool-study" onClick={onOpenStudying}>
          <strong>Изучаю</strong>
          {studying.length === 0 ? (
            <span>Выбери тему или фильм</span>
          ) : (
            <>
              <span>
                {studyingKnown} из {studyingTotal}
              </span>
              <span className="home-tool-bar" aria-hidden>
                <span style={{ width: studyingKnown > 0 ? `max(8px, ${studyingPercent}%)` : "0%" }} />
              </span>
            </>
          )}
        </button>
        <button type="button" className="home-tool tool-stats" onClick={onOpenStats}>
          <strong>Достижения</strong>
          <span>
            {ruPlural(pet.knownCount, "слово", "слова", "слов")} · {catalogShareLabel(pet.knownCount, pet.totalWords)} каталога
          </span>
        </button>
        {showDictionary ? (
          <button type="button" className="home-tool tool-dict" onClick={onOpenDictionary}>
            <strong>Словарь</strong>
            <span>Найти слово</span>
          </button>
        ) : null}
        {showTexts ? (
          <button
            type="button"
            className={`home-tool tool-text${analyzing ? " live" : ""}`}
            onClick={onOpenTexts}
          >
            <strong>{analyzing ? "Текст" : analyzeReady ? "Текст" : "Свой текст"}</strong>
            <span>
              {analyzing ? "Разбираем…" : analyzeReady ? "Можно выбрать слова" : "Статья или заметка"}
            </span>
          </button>
        ) : null}
      </section>
      {onOpenVoice ? <VoiceRow lang={voiceLang} onOpen={onOpenVoice} /> : null}

      <section className="home-section">
        <div className="home-section-head">
          <h2>Кино и сериалы</h2>
          <button type="button" className="home-more" onClick={onOpenMedia}>
            Все
          </button>
        </div>
        <p className="word-list-hint">
          {subscribed ? "В подписке" : "1 фильм или сериал на выбор · остальное по подписке"}
        </p>
        {media.length > 0 ? (
          <div className="poster-carousel">
            {media.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className="poster-tile"
                onClick={() => onOpenTheme(theme)}
              >
                <span className="poster-frame">
                  {theme.posterUrl ? (
                    <img
                      src={theme.posterUrl}
                      alt={theme.title}
                      width={118}
                      height={177}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="poster-fallback">{theme.kind === "movie" ? "F" : "S"}</span>
                  )}
                  {theme.studying ? (
                    <span className="poster-studying">Учу</span>
                  ) : theme.referralPick ? (
                    <span className="poster-studying">За друга</span>
                  ) : theme.freePick ? (
                    <span className="poster-studying">Выбор</span>
                  ) : theme.locked ? (
                    <span className="poster-lock">Подписка</span>
                  ) : null}
                </span>
                <strong>{theme.title}</strong>
                <em>
                  {theme.knownCount}/{theme.wordCount} слов
                </em>
              </button>
            ))}
          </div>
        ) : (
          <p className="word-list-hint">Скоро появятся подборки по фильмам и сериалам.</p>
        )}
      </section>

      {wordBlocks.map((block) => (
        <section key={block.id} className="home-section">
          <div className="home-section-head">
            <h2>{block.title}</h2>
            <button type="button" className="home-more" onClick={onOpenWords}>
              Ещё
            </button>
          </div>
          <ThemeOutlineList
            themes={block.themes.slice(0, HOME_THEMES_PER_BLOCK)}
            subscribed={subscribed}
            onOpen={onOpenTheme}
          />
        </section>
      ))}

      <button type="button" className="home-all" onClick={onOpenWords}>
        Все темы со словами
      </button>

      <button type="button" className="home-teachers" onClick={onTeachers}>
        <span className="home-teachers-faces" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="home-teachers-copy">
          <span className="home-teachers-head">
            <strong>Преподаватели</strong>
            <em>Открыть</em>
          </span>
          <span>Профили преподавателей. Можно написать в Telegram.</span>
        </span>
      </button>

      <div className="home-links">
        <button type="button" className="home-link" onClick={onOpenGuide}>
          <span>Как устроен Моти</span>
          <em>Знакомство</em>
        </button>
        <InviteFriend
          variant="row"
          inviteUrl={referral.inviteUrl}
          pendingInvites={referral.pendingInvites}
          unspentRewards={referral.unspentRewards}
          subscribed={subscribed}
          onOpen={onOpenReferral}
        />
        {extra}
      </div>

      <HomeScreenButton />
      <LegalConsent onOpen={onOpenLegal} className="home-consent" support />
    </div>
  );
}
