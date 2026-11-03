import { useEffect, useMemo, useRef, useState } from "react";
import {
  addStudyWord,
  enrollStudying,
  loadFirstSessionPack,
  loadPet,
  loadStats,
  loadThemes,
  petAction,
  postProgress,
  searchDictionary,
  setMyLanguage,
  setWordKnown,
  visibleError,
} from "../api";
import { track, trackScreen } from "../analytics";
import { languageFlag } from "../languageFlag";
import type { LegalDoc } from "../legal";
import { ruPlural } from "../ru";
import { filterKnownFromSession, knownProgressItems } from "../sessionPack";
import {
  canOfferHomeScreen,
  checkHomeScreenStatus,
  onHomeScreenAdded,
  promptAddToHomeScreen,
  type HomeScreenStatus,
} from "../telegram";
import {
  CEFR_LEVELS,
  type DictionaryHit,
  type FirstSessionSampleWord,
  type LanguageOption,
  type MatchPair,
  type McChoice,
  type MeResponse,
  type PetAction,
  type PetSnapshot,
  type SessionResponse,
  type SessionWord,
  type ThemeSummary,
  type ThemesResponse,
  type UserStats,
} from "../types";
import { targetWord } from "../word";
import { KnowButton } from "./KnowButton";
import { LegalConsent } from "./LegalLinks";
import { Learn } from "./Learn";
import { Match } from "./Match";
import { Moti, MOTI_ACTION_MS, MOTI_REACTION_MS, type MotiReaction } from "./Moti";
import { PosMark } from "./PosMark";
import { ReferralExplain } from "./ReferralExplain";
import { SearchField } from "./SearchField";
import { SpeakButton } from "./SpeakButton";
import { ThemeCard } from "./ThemeList";

const TOTAL_STEPS = 16;
const SKIP_WAIT_SEC = 3;

const STEP_NAMES: Record<number, string> = {
  1: "language",
  2: "words_known",
  3: "learn",
  4: "match",
  5: "coins",
  6: "stats",
  7: "pet_care",
  8: "personal_dictionary",
  9: "paywall_1",
  10: "dictionary_search",
  11: "dictionary_add",
  12: "theme_pick",
  13: "home_screen",
  14: "referral",
  15: "paywall_2",
  16: "done",
};

const LEVEL_TITLES: Record<string, string> = {
  A1: "Начальный",
  A2: "Базовый",
  B1: "Средний",
  B2: "Выше среднего",
  C1: "Продвинутый",
  C2: "Свободный",
};

function shuffleList<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function buildLocalChoices(words: SessionWord[], pool: SessionWord[]): McChoice[] {
  const source = pool.length >= 4 ? pool : words;
  const choices: McChoice[] = [];
  for (const word of words) {
    const ruPool = source.filter((item) => item.id !== word.id).flatMap((item) => item.ru);
    const head = targetWord(word);
    const enPool = source.filter((item) => item.id !== word.id).map((item) => targetWord(item));
    const ruAnswer = word.ru[0] ?? "";
    const ruPicked = shuffleList(ruPool.filter((item) => item !== ruAnswer)).slice(0, 3);
    const ruOptions = [ruAnswer, ...ruPicked];
    while (ruOptions.length < 4) ruOptions.push(ruAnswer);

    const enPicked = shuffleList(enPool.filter((item) => item !== head)).slice(0, 3);
    const enOptions = [head, ...enPicked];
    while (enOptions.length < 4) enOptions.push(head);

    choices.push({
      wordId: word.id,
      direction: "en-ru",
      options: shuffleList(ruOptions).slice(0, 4),
      answer: ruAnswer,
    });
    choices.push({
      wordId: word.id,
      direction: "ru-en",
      options: shuffleList(enOptions).slice(0, 4),
      answer: head,
    });
  }
  return choices;
}

function buildLocalMatchRounds(words: SessionWord[]): MatchPair[][] {
  const pairs: MatchPair[] = words.map((word) => {
    const head = targetWord(word);
    return {
      id: word.id,
      word: head,
      en: head,
      ru: word.ru[0] ?? "",
    };
  });
  if (pairs.length === 0) return [];
  const size = Math.min(6, pairs.length);
  const rounds: MatchPair[][] = [];
  const shuffled = shuffleList(pairs);
  for (let i = 0; i < shuffled.length; i += size) {
    const chunk = shuffled.slice(i, i + size);
    if (chunk.length >= 2) rounds.push(chunk);
    else if (rounds.length > 0) rounds[rounds.length - 1]!.push(...chunk);
    else rounds.push(chunk);
  }
  return rounds;
}

function subsetSession(base: SessionResponse, words: SessionWord[]): SessionResponse {
  return {
    ...base,
    words,
    choices: buildLocalChoices(words, base.words),
    matchRounds: buildLocalMatchRounds(words),
  };
}

function useSkipTimer(active: boolean, key: number): number {
  const [left, setLeft] = useState(SKIP_WAIT_SEC);
  useEffect(() => {
    if (!active) return;
    setLeft(SKIP_WAIT_SEC);
    const id = window.setInterval(() => {
      setLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, key]);
  return left;
}

let savedStep: number | null = null;
let savedBaseSession: SessionResponse | null = null;
let savedStudySession: SessionResponse | null = null;
let savedLearnSession: SessionResponse | null = null;
let savedDictionaryTarget: FirstSessionSampleWord | null = null;

export function FirstSessionFlow({
  me,
  catalog,
  pet,
  onSyncMe,
  onSyncCatalog,
  onSyncPet,
  onOpenLegal,
  onOpenPaywall,
  onComplete,
  inviteUrl,
}: {
  me: MeResponse | null;
  catalog: ThemesResponse;
  pet: PetSnapshot;
  onSyncMe: (next: MeResponse) => void;
  onSyncCatalog: (next: ThemesResponse) => void;
  onSyncPet: (next: PetSnapshot, extra?: { coinsEarned?: number; rescued?: boolean }) => void;
  onOpenLegal: (doc: LegalDoc) => void;
  onOpenPaywall: (step: 9 | 15) => void;
  onComplete: () => void;
  inviteUrl: string;
}) {
  const [step, setStep] = useState(() => {
    const raw = Number(new URLSearchParams(window.location.search).get("firstStep"));
    if (Number.isInteger(raw) && raw >= 1 && raw <= TOTAL_STEPS) return raw;
    return savedStep ?? 1;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseSession, setBaseSession] = useState<SessionResponse | null>(() => savedBaseSession);
  const [knownIds, setKnownIds] = useState<Set<string>>(() => new Set());
  const [studySession, setStudySession] = useState<SessionResponse | null>(() => savedStudySession);
  const [learnSession, setLearnSession] = useState<SessionResponse | null>(() => savedLearnSession);
  const [dictionaryTarget, setDictionaryTarget] = useState<FirstSessionSampleWord | null>(() => savedDictionaryTarget);
  const [startCoins, setStartCoins] = useState(pet.coins);
  const [earnedTotal, setEarnedTotal] = useState(0);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [petActing, setPetActing] = useState<PetAction | null>(null);
  const [petActKey, setPetActKey] = useState(0);
  const [petCared, setPetCared] = useState(false);
  const [dictQuery, setDictQuery] = useState("");
  const [dictHits, setDictHits] = useState<DictionaryHit[]>([]);
  const [dictSearching, setDictSearching] = useState(false);
  const [addedToStudy, setAddedToStudy] = useState(false);
  const [pickedTheme, setPickedTheme] = useState<ThemeSummary | null>(null);
  const [homeStatus, setHomeStatus] = useState<HomeScreenStatus | null>(null);
  const [homePrompted, setHomePrompted] = useState(false);
  const searchReqRef = useRef(0);

  const languages: LanguageOption[] = useMemo(() => {
    if (me?.languages && me.languages.length > 0) return me.languages;
    if (catalog.languages && catalog.languages.length > 0) return catalog.languages;
    return [
      {
        code: me?.language ?? catalog.language ?? "en",
        title: me?.activeLanguage?.title ?? "Английский",
        voice: me?.activeLanguage?.voice ?? "en-US",
        dictionary: true,
        texts: true,
        mediaRequests: true,
      },
    ];
  }, [me, catalog]);

  useEffect(() => {
    savedStep = step;
    savedBaseSession = baseSession;
    savedStudySession = studySession;
    savedLearnSession = learnSession;
    savedDictionaryTarget = dictionaryTarget;
  }, [step, baseSession, studySession, learnSession, dictionaryTarget]);

  function finishFlow() {
    savedStep = null;
    savedBaseSession = null;
    savedStudySession = null;
    savedLearnSession = null;
    savedDictionaryTarget = null;
    onComplete();
  }
  const paywallWait1 = useSkipTimer(step === 9, 9);
  const paywallWait2 = useSkipTimer(step === 15, 15);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector(".app")?.scrollTo(0, 0);
    const stepName = STEP_NAMES[step] ?? `step_${step}`;
    trackScreen({ name: "first-session", section: `${step}-${stepName}` });
    track("first_session_step", { step, step_name: stepName });
  }, [step]);

  // Refresh subscription status when user returns from Tribute tab/app on paywall steps.
  useEffect(() => {
    if (step !== 9 && step !== 12 && step !== 15) return;
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      void loadThemes()
        .then((next) => {
          onSyncCatalog(next);
          if (next.subscribed && step === 15) {
            onComplete();
          }
        })
        .catch(() => undefined);
    };
    onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [step, onSyncCatalog, onComplete]);

  useEffect(() => {
    if (step !== 6) return;
    let alive = true;
    loadStats()
      .then((next) => {
        if (alive) setStats(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [step]);

  useEffect(() => {
    if (step !== 13) return;
    let cancelled = false;
    void checkHomeScreenStatus().then((status) => {
      if (!cancelled) setHomeStatus(status);
    });
    const off = onHomeScreenAdded(() => {
      if (!cancelled) setHomeStatus("added");
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [step]);

  // Dictionary search in step 10 / 11
  useEffect(() => {
    if (step !== 10 && step !== 11) return;
    const trimmed = dictQuery.trim();
    const id = ++searchReqRef.current;
    if (trimmed.length < 2) {
      setDictHits([]);
      setDictSearching(false);
      return;
    }
    setDictSearching(true);
    const timer = window.setTimeout(() => {
      searchDictionary(trimmed)
        .then((res) => {
          if (searchReqRef.current !== id) return;
          const merged = [...res.hits, ...res.alternatives];
          const unique: DictionaryHit[] = [];
          const seen = new Set<string>();
          for (const item of merged) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            unique.push(item);
          }
          setDictHits(unique);
          if (step === 10 && unique.length > 0 && dictionaryTarget) {
            const targetNorm = dictionaryTarget.word.trim().toLowerCase();
            const qNorm = trimmed.toLowerCase();
            const matched = unique.some(
              (hit) =>
                hit.id === dictionaryTarget.id ||
                targetWord(hit).trim().toLowerCase() === targetNorm ||
                qNorm === targetNorm,
            );
            if (matched) setStep(11);
          }
        })
        .catch((err: Error) => {
          if (searchReqRef.current === id) setError(visibleError(err));
        })
        .finally(() => {
          if (searchReqRef.current === id) setDictSearching(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [dictQuery, step, dictionaryTarget]);

  async function pickLanguage(code: string) {
    setBusy(true);
    setError(null);
    try {
      const profile = await setMyLanguage(code);
      onSyncMe(profile);
      const [themesData, petData, pack] = await Promise.all([
        loadThemes(),
        loadPet(),
        loadFirstSessionPack(),
      ]);
      onSyncCatalog(themesData);
      onSyncPet(petData.pet);
      setStartCoins(petData.pet.coins);
      setBaseSession(pack.session);
      setKnownIds(new Set());
      setDictionaryTarget(
        pack.dictionaryTarget ??
          (pack.session.words[0]
            ? {
                id: pack.session.words[0].id,
                word: targetWord(pack.session.words[0]),
                ru: pack.session.words[0].ru,
                level: pack.session.words[0].level,
              }
            : null),
      );
      setStep(2);
      track("first_session_language_chosen", { language: code });
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleKnown(id: string) {
    setKnownIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmKnownSelection() {
    if (!baseSession) return;
    setBusy(true);
    setError(null);
    try {
      const marked = [...knownIds];
      if (marked.length > 0) {
        const res = await postProgress(knownProgressItems(baseSession.themeId, marked));
        if (res?.pet) {
          onSyncPet(res.pet, res);
          setEarnedTotal((prev) => prev + (res.coinsEarned ?? 0));
        }
      }
      const filtered = filterKnownFromSession(baseSession, knownIds);
      const activeWords = filtered.words;
      const matchPack = subsetSession(baseSession, activeWords.slice(0, 6));
      const learnPack = subsetSession(baseSession, activeWords.slice(0, 3));
      setStudySession(matchPack);
      setLearnSession(learnPack);
      track("first_session_known_confirmed", {
        known_count: marked.length,
        remaining_count: Math.max(0, baseSession.words.length - marked.length),
      });
      if (learnPack.words.length > 0) setStep(3);
      else if (matchPack.words.length >= 2) setStep(4);
      else setStep(5);
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  async function afterLearnDone() {
    setBusy(true);
    let delta = earnedTotal;
    try {
      const [loaded, themesData] = await Promise.all([loadPet(), loadThemes()]);
      onSyncPet(loaded.pet);
      onSyncCatalog(themesData);
      delta = Math.max(earnedTotal, Math.max(0, loaded.pet.coins - startCoins));
      if (delta > earnedTotal) setEarnedTotal(delta);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      track("first_session_learn_completed", { coins_earned: delta });
      setStep(studySession && studySession.words.length >= 2 ? 4 : 5);
    }
  }

  async function afterMatchDone() {
    setBusy(true);
    try {
      const [loaded, themesData] = await Promise.all([loadPet(), loadThemes()]);
      onSyncPet(loaded.pet);
      onSyncCatalog(themesData);
      const delta = Math.max(earnedTotal, Math.max(0, loaded.pet.coins - startCoins));
      if (delta > earnedTotal) setEarnedTotal(delta);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      track("first_session_match_completed");
      setStep(5);
    }
  }

  async function handleCare(action: PetAction) {
    setBusy(true);
    setError(null);
    try {
      const res = await petAction(action);
      onSyncPet(res.pet);
      setPetActing(action);
      setPetActKey((k) => k + 1);
      setPetCared(true);
      track("pet_cared", { action, source: "first_session" });
      window.setTimeout(() => setPetActing(null), MOTI_ACTION_MS);
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddWordToStudy(wordId: string) {
    setBusy(true);
    setError(null);
    try {
      await addStudyWord(wordId);
      setAddedToStudy(true);
      track("first_session_dictionary_added", { word_id: wordId });
      const themesData = await loadThemes();
      onSyncCatalog(themesData);
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePickTheme(theme: ThemeSummary) {
    setBusy(true);
    setError(null);
    try {
      await enrollStudying([theme.id]);
      setPickedTheme(theme);
      track("first_session_theme_picked", {
        theme_id: theme.id,
        paid: theme.paid,
        subscribed: catalog.subscribed,
      });
      const themesData = await loadThemes();
      onSyncCatalog(themesData);
      setStep(13);
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  function goAfterStep13() {
    setStep(14);
  }

  function goAfterReferral() {
    if (catalog.subscribed) finishFlow();
    else setStep(15);
  }

  const progressPct = Math.round((step / TOTAL_STEPS) * 100);
  const words = baseSession?.words ?? [];
  const canCare = pet.coins >= pet.actionCost && pet.status !== "cryo" && pet.status !== "graduated";

  return (
    <div className="welcome first-flow" data-first-step={step}>
      <header className="welcome-top">
        <p>
          Шаг {step} из {TOTAL_STEPS}
        </p>
      </header>
      <div
        className="welcome-track"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={step}
        aria-label="Первая сессия"
      >
        <span style={{ width: `${progressPct}%` }} />
      </div>

      {error ? <p className="feedback bad">{error}</p> : null}

      {step === 1 ? (
        <>
          <div className="welcome-body" key="step-1">
            <p className="welcome-kicker">Шаг 1 · Язык</p>
            <h1>Какой язык учим?</h1>
            <p className="welcome-lead">
              Выбери язык. Переводы и подсказки останутся на русском.
            </p>
            <div className="stack">
              {languages.map((lang) => {
                const flag = languageFlag(lang.code);
                return (
                  <button
                    key={lang.code}
                    type="button"
                    className="primary language-option"
                    disabled={busy}
                    onClick={() => void pickLanguage(lang.code)}
                  >
                    {flag ? (
                      <span className="language-flag" aria-hidden="true">
                        {flag}
                      </span>
                    ) : null}
                    {lang.title}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="welcome-actions">
            <LegalConsent onOpen={onOpenLegal} className="welcome-legal" />
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div className="welcome-body" key="step-2">
            <p className="welcome-kicker">Шаг 2 · Подборка A1–C2</p>
            <h1>Отметь, что уже знаешь</h1>
            <p className="welcome-lead">
              {words.length} случайных слов, уровни A1–C2. Знакомое даёт Моти +{pet.coinsPerKnownWord} монет и не попадает в тренировку.
            </p>
            <div className="level-pills" aria-label="Уровни CEFR">
              {CEFR_LEVELS.map((lvl) => {
                const count = words.filter((w) => w.level === lvl).length;
                return count > 0 ? (
                  <span key={lvl} className="level-pill">
                    {lvl} · {count}
                  </span>
                ) : null;
              })}
            </div>
            <div className="known-mark-bar">
              <p className="progress">
                Уже знаю {knownIds.size} · учить {Math.max(0, words.length - knownIds.size)}
              </p>
            </div>
            <div className="known-list known-mark-list">
              {words.map((word) => {
                const marked = knownIds.has(word.id);
                return (
                  <div key={word.id} className={`word-row${marked ? " known" : ""}`}>
                    <button
                      type="button"
                      className="word-row-main"
                      disabled={busy}
                      onClick={() => toggleKnown(word.id)}
                    >
                      <span className="word-en">
                        <strong>
                          {targetWord(word)}
                          {word.wordCyrillic ? <span className="word-cyr"> {word.wordCyrillic}</span> : null}
                        </strong>
                        <span className="level-pill">{word.level}</span>
                        <PosMark pos={word.pos} gender={word.gender} />
                      </span>
                      <span className="ru">{word.ru.join(" / ")}</span>
                    </button>
                    <div className="word-row-actions">
                      <SpeakButton text={targetWord(word)} />
                      <KnowButton known={marked} disabled={busy} onClick={() => toggleKnown(word.id)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="welcome-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void confirmKnownSelection()}>
              Перейти к «Учить»
            </button>
          </div>
        </>
      ) : null}

      {step === 3 && learnSession ? (
        <div className="welcome-body" key="step-3">
          <p className="welcome-kicker">Шаг 3 · Упражнение «Учить»</p>
          <h1>Карточка, потом ответ</h1>
          <Learn session={learnSession} motiCoins={pet.coins} onDone={() => void afterLearnDone()} />
        </div>
      ) : null}

      {step === 4 && studySession ? (
        <div className="welcome-body" key="step-4">
          <p className="welcome-kicker">Шаг 4 · Упражнение «Найти пару»</p>
          <h1>Соедини слово и перевод</h1>
          <Match session={studySession} motiCoins={pet.coins} onDone={() => void afterMatchDone()} />
        </div>
      ) : null}

      {step === 5 ? (
        <FirstCoinsStep
          pet={pet}
          earned={Math.max(earnedTotal, Math.max(0, pet.coins - startCoins))}
          onNext={() => setStep(6)}
        />
      ) : null}

      {step === 6 ? (
        <>
          <div className="welcome-body" key="step-6">
            <p className="welcome-kicker">Шаг 6 · Твои достижения</p>
            <h1>Вот твой прогресс</h1>
            <p className="welcome-lead">
              Слова, точность, серия дней и уровни A1–C2.
            </p>
            <FirstStatsPreview stats={stats} pet={pet} />
          </div>
          <div className="welcome-actions">
            <button type="button" className="primary" onClick={() => setStep(7)}>
              Дальше — к Моти
            </button>
          </div>
        </>
      ) : null}

      {step === 7 ? (
        <>
          <div className="welcome-body" key="step-7">
            <p className="welcome-kicker">Шаг 7 · Позаботься о Моти</p>
            <h1>Покорми или развлеки Моти</h1>
            <p className="welcome-lead">
              Монеты за слова уходят на сытость и настроение.
            </p>
            <Moti pet={pet} acting={petActing} actKey={petActKey} />
            <div className="need-list">
              <div className="need">
                <div className="row">
                  <span>Сытость</span>
                  <span>{pet.hunger}%</span>
                </div>
                <div className="bar" aria-hidden>
                  <span style={{ width: `${pet.hunger}%` }} />
                </div>
              </div>
              <div className="need">
                <div className="row">
                  <span>Настроение</span>
                  <span>{pet.mood}%</span>
                </div>
                <div className="bar" aria-hidden>
                  <span style={{ width: `${pet.mood}%` }} />
                </div>
              </div>
            </div>
            <p className="progress">Баланс: {ruPlural(pet.coins, "монета", "монеты", "монет")}</p>
            <div className="actions-grid">
              <button
                type="button"
                className="mode-card"
                disabled={busy || !canCare}
                onClick={() => void handleCare("feed")}
              >
                <strong>Кормить</strong>
                <p>{pet.actionCost} монет · сытость</p>
              </button>
              <button
                type="button"
                className="mode-card"
                disabled={busy || !canCare}
                onClick={() => void handleCare("play")}
              >
                <strong>Развлечь</strong>
                <p>{pet.actionCost} монет · настроение</p>
              </button>
            </div>
          </div>
          <div className="welcome-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || (!petCared && canCare)}
              onClick={() => setStep(8)}
            >
              {petCared || !canCare ? "Дальше" : "Покорми или развлеки Моти"}
            </button>
          </div>
        </>
      ) : null}

      {step === 8 ? (
        <>
          <div className="welcome-body" key="step-8">
            <p className="welcome-kicker">Шаг 8 · Персональный словарь</p>
            <h1>Твой словарь</h1>
            <p className="welcome-lead">
              Отмечай знакомые слова и бери новые в учёбу.
            </p>
            <div className="welcome-grid">
              <article className="welcome-point">
                <strong>Знакомые</strong>
                <span>Отметь слово — в тренировке останутся только новые.</span>
              </article>
              <article className="welcome-point">
                <strong>Поиск</strong>
                <span>Ищи слово или перевод и добавляй его в «Мои слова».</span>
              </article>
              <article className="welcome-point">
                <strong>Прогресс</strong>
                <span>Слово двигает цель и потом всплывает на контрольной и экзамене.</span>
              </article>
            </div>
          </div>
          <div className="welcome-actions">
            <button type="button" className="primary" onClick={() => setStep(9)}>
              Дальше
            </button>
          </div>
        </>
      ) : null}

      {step === 9 ? (
        <FirstPaywallStep
          stepNumber={9}
          kicker="Шаг 9 · Полный доступ"
          title="Открой все темы, кино и тексты"
          lead="Все темы, фильмы и сериалы, до 8 текстов по 20 000 знаков и преподаватели."
          emphasizeYearly={false}
          waitSeconds={paywallWait1}
          onOpen={() => onOpenPaywall(9)}
          onSkip={() => {
            track("first_session_paywall_skipped", { step: 9 });
            setStep(10);
          }}
        />
      ) : null}

      {(step === 10 || step === 11) && dictionaryTarget ? (
        <>
          <div className="welcome-body" key="step-10-11">
            <p className="welcome-kicker">
              {step === 10 ? "Шаг 10 · Поиск в словаре" : "Шаг 11 · Добавь в «Учить»"}
            </p>
            <h1>
              {step === 10
                ? `Найди слово «${dictionaryTarget.word}»`
                : `Добавь «${dictionaryTarget.word}» в «Учить»`}
            </h1>
            <p className="welcome-lead">
              {step === 10
                ? dictionaryTarget.ru[0]
                  ? `«${dictionaryTarget.ru[0]}». Впиши слово или нажми кнопку под строкой.`
                  : "Впиши слово или нажми кнопку под строкой."
                : "Нажми «Учить» — слово попадёт в «Мои слова»."}
            </p>

            <div className="dictionary-search">
              <SearchField
                className="word-list-search"
                value={dictQuery}
                autoFocus={step === 10}
                placeholder={`Найди: ${dictionaryTarget.word}`}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={setDictQuery}
              />
            </div>

            {step === 10 && dictQuery.trim().toLowerCase() !== dictionaryTarget.word.toLowerCase() ? (
              <button
                type="button"
                className="ghost"
                onClick={() => setDictQuery(dictionaryTarget.word)}
              >
                Подставить «{dictionaryTarget.word}»
              </button>
            ) : null}

            {dictSearching ? <p className="word-list-hint">Ищем в словаре…</p> : null}

            {dictHits.length > 0 ? (
              <div className="dictionary-cards">
                {dictHits.slice(0, 4).map((hit) => {
                  const isStudying = addedToStudy || Boolean(hit.studying);
                  return (
                    <article key={hit.id} className="dictionary-card">
                      <header>
                        <strong>{targetWord(hit)}</strong>
                        <SpeakButton text={targetWord(hit)} />
                        <PosMark pos={hit.pos} gender={hit.gender} />
                        <span className="pill">{hit.level}</span>
                        {isStudying ? <span className="pill">Учу</span> : null}
                      </header>
                      <p className="ru">{hit.ru.join(" / ")}</p>
                      {hit.example ? <p className="dictionary-example">{hit.example}</p> : null}
                      {hit.source ? <p className="dictionary-source">{hit.source}</p> : null}
                      <div className="dictionary-actions">
                        <button
                          type="button"
                          className={`study-btn${isStudying ? " studying" : ""}`}
                          aria-pressed={isStudying}
                          disabled={busy}
                          onClick={() => void handleAddWordToStudy(hit.id)}
                        >
                          {isStudying ? "В списке «Учить»" : "Учить"}
                        </button>
                        <KnowButton
                          known={hit.known}
                          disabled={busy}
                          onClick={() => {
                            void setWordKnown(hit.themeId, hit.id, !hit.known)
                              .then((res) => {
                                if (res.pet) onSyncPet(res.pet, res);
                              })
                              .catch(() => undefined);
                          }}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="welcome-actions">
            {step === 11 ? (
              <button
                type="button"
                className="primary"
                disabled={busy || !addedToStudy}
                onClick={() => setStep(12)}
              >
                {addedToStudy ? "Дальше — выбрать тему" : "Нажми «Учить» на карточке"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {step === 12 ? (
        <FirstThemePickStep
          catalog={catalog}
          busy={busy}
          picked={pickedTheme}
          onPick={(theme) => void handlePickTheme(theme)}
        />
      ) : null}

      {step === 13 ? (
        <>
          <div className="welcome-body" key="step-13">
            <p className="welcome-kicker">Шаг 13 · Быстрый вход</p>
            <h1>Добавь Моти на экран</h1>
            <p className="welcome-lead">
              Иконка открывает словарь в один тап.
            </p>
            <div className="welcome-grid">
              <article className="welcome-point">
                <strong>Один тап</strong>
                <span>Словарь открывается сразу на весь экран.</span>
              </article>
              <article className="welcome-point">
                <strong>Серия дней</strong>
                <span>Пара минут в день сохраняет серию и сытость Моти.</span>
              </article>
            </div>
            {homeStatus === "added" ? (
              <p className="feedback ok">Иконка уже добавлена на экран «Домой»</p>
            ) : null}
          </div>
          <div className="welcome-actions">
            {homePrompted || homeStatus === "added" ? (
              <button type="button" className="primary" onClick={goAfterStep13}>
                Дальше
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const called = promptAddToHomeScreen();
                  track("first_session_home_screen_prompted", { supported: called });
                  setHomePrompted(true);
                  if (!called && !canOfferHomeScreen(homeStatus ?? "unknown")) {
                    goAfterStep13();
                  }
                }}
              >
                Добавить на рабочий стол
              </button>
            )}
          </div>
        </>
      ) : null}

      {step === 14 ? (
        <ReferralExplain
          inviteUrl={inviteUrl}
          source="first_session"
          subscribed={catalog.subscribed}
          unspentRewards={0}
          pendingInvites={0}
          stepLabel="Шаг 14 · Пригласи друга"
          onContinue={goAfterReferral}
        />
      ) : null}

      {step === 15 ? (
        <FirstPaywallStep
          stepNumber={15}
          kicker="Шаг 15 · Тариф на год"
          title="Год на 45% дешевле"
          lead="Все темы, фильмы, сериалы и свои тексты на 12 месяцев."
          emphasizeYearly
          waitSeconds={paywallWait2}
          onOpen={() => onOpenPaywall(15)}
          onSkip={() => {
            track("first_session_paywall_skipped", { step: 15 });
            setStep(16);
          }}
        />
      ) : null}

      {step === 16 ? (
        <>
          <div className="welcome-body" key="step-16">
            <Moti pet={pet} acting={null} actKey={0} />
            <p className="welcome-kicker">Шаг 16 · Всё готово</p>
            <h1>Первая сессия готова</h1>
            <p className="welcome-lead">
              Язык, первые слова, монеты и тема уже на месте.
            </p>
          </div>
          <div className="welcome-actions">
            <button type="button" className="primary" disabled={busy} onClick={finishFlow}>
              Перейти на главный экран
            </button>
            <LegalConsent onOpen={onOpenLegal} className="welcome-legal" />
          </div>
        </>
      ) : null}
    </div>
  );
}

function FirstCoinsStep({
  pet,
  earned,
  onNext,
}: {
  pet: PetSnapshot;
  earned: number;
  onNext: () => void;
}) {
  const [reaction, setReaction] = useState<MotiReaction | null>("coins");
  useEffect(() => {
    const id = window.setTimeout(() => setReaction(null), MOTI_REACTION_MS.coins);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      <div className="welcome-body" key="step-5">
        <p className="welcome-kicker">Шаг 5 · Награда за слова</p>
        <h1>
          {earned > 0
            ? `Ты заработал +${ruPlural(earned, "монету", "монеты", "монет")}!`
            : `У Моти ${ruPlural(pet.coins, "монета", "монеты", "монет")}`}
        </h1>
        <p className="welcome-lead">
          Новое слово даёт +{pet.coinsPerKnownWord} монет. Ими кормишь и развлекаешь Моти.
        </p>
        <Moti pet={pet} acting={null} actKey={0} reaction={reaction} reactKey={1} />
        <div className="stats-pair">
          <article className="stats-pair-card coins">
            <span>За сессию</span>
            <strong>+{earned}</strong>
            <em>{ruPlural(earned, "монета", "монеты", "монет").replace(/^\S+\s/, "")}</em>
          </article>
          <article className="stats-pair-card streak">
            <span>Баланс у Моти</span>
            <strong>{pet.coins}</strong>
            <em>{ruPlural(pet.coins, "монета", "монеты", "монет").replace(/^\S+\s/, "")}</em>
          </article>
        </div>
      </div>
      <div className="welcome-actions">
        <button type="button" className="primary" onClick={onNext}>
          Посмотреть прогресс
        </button>
      </div>
    </>
  );
}

function FirstStatsPreview({ stats, pet }: { stats: UserStats | null; pet: PetSnapshot }) {
  const known = stats?.known ?? pet.knownCount;
  const total = stats?.total ?? pet.totalWords;
  const accuracy = stats?.accuracy ?? null;
  const streak = stats?.streak ?? 1;
  const coins = stats?.coins ?? pet.coins;
  const knownLevels = (stats?.levels ?? []).filter((lvl) => lvl.known > 0);
  const nextGoal = [10, 25, 50, 100, 250, 500, 1000].find((g) => g > known) ?? Math.max(10, total);
  const pct = Math.min(100, Math.round((known / Math.max(1, nextGoal)) * 100));

  return (
    <div className="stats">
      <section className="stats-hero">
        <div className="stats-ring" style={{ ["--p" as string]: String(pct) }}>
          <div className="stats-ring-core">
            <strong>{known.toLocaleString("ru-RU")}</strong>
            <span>{ruPlural(known, "слово", "слова", "слов").replace(/^\S+\s/, "")}</span>
          </div>
        </div>
        <p className="stats-goal">
          Ещё {ruPlural(Math.max(0, nextGoal - known), "слово", "слова", "слов")} до цели {nextGoal}
        </p>
      </section>

      <div className="stats-pair">
        <article className="stats-pair-card streak">
          <span>Серия</span>
          <strong>{streak}</strong>
          <em>{ruPlural(streak, "день подряд", "дня подряд", "дней подряд").replace(/^\S+\s/, "")}</em>
        </article>
        <article className="stats-pair-card coins">
          <span>Монеты</span>
          <strong>{coins.toLocaleString("ru-RU")}</strong>
          <em>у Моти · точность {accuracy === null ? "—" : `${accuracy}%`}</em>
        </article>
      </div>

      {knownLevels.length > 0 ? (
        <section className="stats-panel">
          <div className="stats-panel-head">
            <h2>Твои слова по уровням</h2>
            <em>{ruPlural(known, "слово", "слова", "слов")}</em>
          </div>
          <ul className="stats-legend">
            {knownLevels.map((lvl) => (
              <li key={lvl.level}>
                <i className={`lv-${lvl.level}`} />
                <strong>{lvl.level}</strong>
                <span>{LEVEL_TITLES[lvl.level] ?? lvl.level}</span>
                <em>{lvl.known}</em>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function FirstPaywallStep({
  stepNumber,
  kicker,
  title,
  lead,
  emphasizeYearly,
  waitSeconds,
  onOpen,
  onSkip,
}: {
  stepNumber: number;
  kicker: string;
  title: string;
  lead: string;
  emphasizeYearly: boolean;
  waitSeconds: number;
  onOpen: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="welcome-body" key={`paywall-${stepNumber}`}>
        <p className="welcome-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p className="welcome-lead">{lead}</p>

        <div className="welcome-grid">
          {emphasizeYearly ? (
            <>
              <article className="welcome-point">
                <strong>Один платёж</strong>
                <span>На 45% дешевле, чем продлевать каждый месяц.</span>
              </article>
              <article className="welcome-point">
                <strong>Весь каталог</strong>
                <span>Темы A1–C2, фильмы, сериалы, свои тексты и преподаватели.</span>
              </article>
            </>
          ) : (
            <>
              <article className="welcome-point">
                <strong>Темы A1–C2</strong>
                <span>Все подборки открыты.</span>
              </article>
              <article className="welcome-point">
                <strong>Кино и тексты</strong>
                <span>Слова из фильмов и сериалов и разбор своих текстов.</span>
              </article>
            </>
          )}
        </div>
      </div>

      <div className="welcome-actions">
        <button type="button" className="primary" onClick={onOpen}>
          {emphasizeYearly ? "Смотреть тарифы" : "Оформить доступ"}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={waitSeconds > 0}
          onClick={onSkip}
        >
          {waitSeconds > 0 ? `Пропустить через ${waitSeconds} с` : "Пропустить"}
        </button>
      </div>
    </>
  );
}

function FirstThemePickStep({
  catalog,
  busy,
  picked,
  onPick,
}: {
  catalog: ThemesResponse;
  busy: boolean;
  picked: ThemeSummary | null;
  onPick: (theme: ThemeSummary) => void;
}) {
  const themes = useMemo(() => {
    const wordThemes = catalog.themes.filter(
      (t) => t.blockId !== "media" && t.kind !== "text" && t.id !== "my-words",
    );
    if (catalog.subscribed) {
      const paidFirst = [
        ...wordThemes.filter((t) => t.paid),
        ...wordThemes.filter((t) => !t.paid),
      ];
      return paidFirst.slice(0, 8);
    }
    return wordThemes.filter((t) => !t.locked && !t.paid).slice(0, 8);
  }, [catalog.themes, catalog.subscribed]);

  return (
    <div className="welcome-body" key="step-12">
      <p className="welcome-kicker">Шаг 12 · Первая тема</p>
      <h1>Выбери тему</h1>
      <p className="welcome-lead">
        {catalog.subscribed
          ? "Можно любую. Она попадёт в «Изучаю»."
          : "Бесплатные темы. Выбранная попадёт в «Изучаю»."}
      </p>
      <div className="stack" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
        {themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={picked?.id === theme.id ? { ...theme, studying: true } : theme}
            subscribed={catalog.subscribed}
            onOpen={onPick}
          />
        ))}
      </div>
    </div>
  );
}
