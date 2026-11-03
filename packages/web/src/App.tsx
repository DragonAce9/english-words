import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeUserTexts,
  deleteUserText,
  createTeacher,
  deleteTeacher,
  leaveTeacherList,
  refreshTeacherPhoto,
  loadMe,
  loadPet,
  loadTeachers,
  loadTexts,
  loadThemeWords,
  loadThemes,
  markGuideTry,
  markOnboardingDone,
  petAction,
  postProgress,
  setWordKnown,
  setMyLanguage,
  startSession,
  enrollStudying,
  unenrollStudying,
  visibleError,
} from "./api";
import { mergeGuideTries, practiceTheme } from "./guide";
import { cacheOnboardingDone, shouldShowOnboarding } from "./onboarding";
import { localDate } from "./localDate";
import { filterKnownFromSession, knownProgressItems } from "./sessionPack";
import { screenAnalyticsKey, syncLearner, track, trackScreen } from "./analytics";
import { setVoiceLang } from "./speak";
import { isInsideTelegram } from "./telegram";
import { preloadMotiOpening } from "./views/Moti";
import { setLanguageCode } from "./word";
import type {
  CefrLevel,
  DailyFact,
  PetAction,
  PetSnapshot,
  ReferralSummary,
  MeResponse,
  SessionMode,
  SessionResponse,
  SessionWord,
  TeacherCard,
  ThemeSummary,
  TextsResponse,
  ThemeWordListItem,
  ThemeWordListResponse,
  ThemesResponse,
  GuideTry,
} from "./types";
import { clearLegalUrl, openLegalUrl, readLegalDoc, type LegalDoc } from "./legal";
import { setTelegramBackHandler } from "./telegram";
import { AccessBanner, CatalogBar } from "./views/AccessBanner";
import { LanguagePick } from "./views/LanguagePick";
import { VoicePick } from "./views/VoicePick";
import { KnownMark } from "./views/KnownMark";
import { Exam } from "./views/Exam";
import { Learn } from "./views/Learn";
import { LegalScreen } from "./views/LegalScreen";
import { Match } from "./views/Match";
import { HomeFeed } from "./views/HomeFeed";
import { ReferralExplain } from "./views/ReferralExplain";
import { ReferralPicker } from "./views/ReferralPicker";
import { Paywall } from "./views/Paywall";
import { TeachersFeed } from "./views/TeachersFeed";
import { Recall } from "./views/Recall";
import { episodeMeta, findSeries, studyingPackIds } from "./mediaGroup";
import { ThemeList } from "./views/ThemeList";
import { TextsScreen } from "./views/TextsScreen";
import { SeriesScreen } from "./views/SeriesScreen";
import { DictionaryScreen } from "./views/DictionaryScreen";
import { ScreenHeader } from "./views/ScreenHeader";
import { StatsScreen } from "./views/StatsScreen";
import { StudyingScreen } from "./views/StudyingScreen";
import { ThemeScreen } from "./views/ThemeScreen";
import { FirstSessionFlow } from "./views/FirstSessionFlow";
import { resetWelcomeStep, Welcome } from "./views/Welcome";
import { WordList } from "./views/WordList";

const HiddenHomeEntry = lazy(() => import("./views/hidden-game").then((mod) => ({ default: mod.HiddenHomeEntry })));
const HiddenStats = lazy(() => import("./views/hidden-game").then((mod) => ({ default: mod.HiddenStats })));
const HiddenScreen = lazy(() => import("./views/hidden-game").then((mod) => ({ default: mod.HiddenScreen })));

type ListSection = "media" | "words";
type ReturnTo = "home" | ListSection | "texts" | "studying";

type Screen =
  | { name: "language"; from: "start" | "settings" }
  | { name: "voice" }
  | { name: "welcome" }
  | { name: "first-session" }
  | { name: "home" }
  | { name: "referral" }
  | { name: "referral-pick" }
  | { name: "list"; section: ListSection }
  | { name: "studying" }
  | { name: "stats" }
  | { name: "dictionary" }
  | { name: "series"; show: ThemeSummary }
  | { name: "texts"; data: TextsResponse }
  | {
      name: "teachers";
      teachers: TeacherCard[];
      locked?: boolean;
      admin?: boolean;
      listed?: boolean;
      ownProfile?: boolean;
      teachLanguages?: { code: string; title: string }[];
      account?: { telegramUserId: number; telegramUsername: string | null };
    }
  | { name: "theme"; theme: ThemeSummary }
  | { name: "words"; theme: ThemeSummary; level: CefrLevel | null; list: ThemeWordListResponse }
  | { name: "paywall"; theme?: ThemeSummary; reason?: "teachers"; from?: "home" | "first-session"; step?: 9 | 15 }
  | { name: "legal"; doc: LegalDoc }
  | { name: "known"; theme: ThemeSummary; mode: SessionMode; session: SessionResponse }
  | { name: "session"; theme: ThemeSummary; mode: SessionMode; session: SessionResponse }
  | { name: "exam"; words: SessionWord[] }
  | { name: "aside" };

function paywallSource(screen: { from?: "home" | "first-session"; reason?: "teachers"; step?: 9 | 15 }): string {
  if (screen.from === "first-session") return screen.step === 15 ? "first_session_15" : "first_session_9";
  if (screen.reason === "teachers") return "teachers";
  if (screen.from === "home") return "banner";
  return "paywall";
}

function languageProfile(profile: MeResponse) {
  if (profile.activeLanguage?.code === profile.language) return profile.activeLanguage;
  return profile.languages.find((item) => item.code === profile.language) ?? profile.languages[0];
}

export function App() {
  const [catalog, setCatalog] = useState<ThemesResponse | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [pet, setPet] = useState<PetSnapshot | null>(null);
  const [motiReady, setMotiReady] = useState(false);
  const motiPreloadStarted = useRef(false);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [dailyFact, setDailyFact] = useState<DailyFact | null>(null);
  const [screen, setScreen] = useState<Screen | null>(() => {
    const doc = readLegalDoc();
    return doc ? { name: "legal", doc } : null;
  });
  const legalFromRef = useRef<Screen | null>(null);
  const guideSent = useRef(new Set<GuideTry>());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeReady, setAnalyzeReady] = useState(false);
  const [textsData, setTextsData] = useState<TextsResponse | null>(null);
  const [wordBusyId, setWordBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [coinsFlash, setCoinsFlash] = useState(0);
  const [rescued, setRescued] = useState(false);
  const [rescuePlay, setRescuePlay] = useState(false);
  const [returnTo, setReturnTo] = useState<ReturnTo>("home");
  const [openShowId, setOpenShowId] = useState<string | null>(null);
  const petRef = useRef<PetSnapshot | null>(null);
  const screenRef = useRef<Screen | null>(null);
  const closePaywallRef = useRef<(current: Extract<Screen, { name: "paywall" }>) => void>(() => undefined);
  const examFlushRef = useRef<(() => Promise<void>) | null>(null);
  screenRef.current = screen;
  const bindExamFlush = useCallback((flush: (() => Promise<void>) | null) => {
    examFlushRef.current = flush;
  }, []);

  function rememberPet(next: PetSnapshot, extra?: { coinsEarned?: number; rescued?: boolean }) {
    const fromCryo = petRef.current?.status === "cryo" && next.status === "alive";
    if (fromCryo || extra?.rescued) {
      setRescued(true);
      setRescuePlay(true);
    }
    if (extra?.coinsEarned && extra.coinsEarned > 0) setCoinsFlash(extra.coinsEarned);
    petRef.current = next;
    setPet(next);
  }

  function applyMe(profile: MeResponse) {
    setMe(profile);
    const current = languageProfile(profile);
    if (!current) return;
    setVoiceLang(current.voice);
    setLanguageCode(current.code);
  }

  function replaceCatalog(data: ThemesResponse) {
    setCatalog((current) => ({
      ...data,
      guideTries: mergeGuideTries(data.guideTries ?? [], current?.guideTries ?? []),
    }));
  }

  async function refresh() {
    const [data, loaded] = await Promise.all([loadThemes(), loadPet()]);
    replaceCatalog(data);
    rememberPet(loaded.pet);
    setReferral(loaded.referral);
    setDailyFact(loaded.fact);
    return data;
  }

  useEffect(() => {
    if (!pet || motiPreloadStarted.current) return;
    motiPreloadStarted.current = true;
    const timeout = window.setTimeout(() => setMotiReady(true), 12000);
    void preloadMotiOpening(pet).finally(() => {
      window.clearTimeout(timeout);
      setMotiReady(true);
    });
  }, [pet]);

  useEffect(() => {
    Promise.all([loadThemes(), loadPet(), loadMe()])
      .then(([data, loaded, profile]) => {
        applyMe(profile);
        replaceCatalog(data);
        rememberPet(loaded.pet);
        setReferral(loaded.referral);
        setDailyFact(loaded.fact);
        setScreen((current) => {
          if (current?.name === "legal") return current;
          const legal = readLegalDoc();
          if (legal) return { name: "legal", doc: legal };
          if (shouldShowOnboarding(data, loaded.pet)) return { name: "first-session" };
          if (profile.languages.length > 1 && !profile.languageChosen) return { name: "language", from: "start" };
          return { name: "home" };
        });
      })
      .catch((err: Error) => setError(visibleError(err)));
  }, []);

  function openGuide() {
    resetWelcomeStep();
    setScreen({ name: "welcome" });
  }

  async function chooseLanguage(code: string) {
    const from = screenRef.current?.name === "language" ? screenRef.current.from : "settings";
    setLoading(true);
    setError(null);
    try {
      const profile = await setMyLanguage(code);
      applyMe(profile);
      setTextsData(null);
      const data = await refresh();
      const petNow = petRef.current;
      setScreen(from === "start" && petNow && shouldShowOnboarding(data, petNow) ? { name: "first-session" } : { name: "home" });
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  function dismissOnboarding(next: "home" | "list") {
    const first = !catalog?.onboardingDone;
    cacheOnboardingDone();
    setCatalog((current) => (current ? { ...current, onboardingDone: true } : current));
    setScreen(next === "list" ? { name: "list", section: "words" } : { name: "home" });
    if (first) track("onboarding_completed");
    void markOnboardingDone().catch(() => undefined);
  }

  const noteGuideTry = useCallback((id: GuideTry) => {
    setCatalog((current) => {
      if (!current || (current.guideTries ?? []).includes(id)) return current;
      return { ...current, guideTries: mergeGuideTries(current.guideTries ?? [], [id]) };
    });
    if (guideSent.current.has(id)) return;
    guideSent.current.add(id);
    void markGuideTry(id)
      .then((result) => {
        setCatalog((current) => (current ? { ...current, guideTries: mergeGuideTries(result.tries, current.guideTries) } : current));
      })
      .catch(() => {
        guideSent.current.delete(id);
      });
  }, []);

  useEffect(() => {
    if (!screen) return;
    if (
      screen.name === "dictionary" ||
      screen.name === "texts" ||
      screen.name === "series" ||
      (screen.name === "list" && screen.section === "media") ||
      (screen.name === "theme" &&
        (screen.theme.kind === "movie" || screen.theme.kind === "episode" || screen.theme.kind === "series"))
    ) {
      noteGuideTry("words");
      return;
    }
    if (screen.name === "stats" || screen.name === "studying") {
      noteGuideTry("path");
      return;
    }
    if (screen.name === "session" || screen.name === "known" || screen.name === "exam") {
      noteGuideTry("study");
    }
  }, [screen, noteGuideTry]);

  const analyticsKey = screen ? screenAnalyticsKey(screen) : "";
  useEffect(() => {
    const current = screenRef.current;
    if (!current) return;
    trackScreen(current);
    if (current.name === "paywall") {
      const opened: { source: string; step?: number; theme_id?: string } = { source: paywallSource(current) };
      if (current.step) opened.step = current.step;
      if (current.theme) opened.theme_id = current.theme.id;
      track("paywall_opened", opened);
    }
  }, [analyticsKey]);

  useEffect(() => {
    if (!catalog) return;
    syncLearner({ subscribed: catalog.subscribed, devUser: catalog.devUser });
  }, [catalog?.subscribed, catalog?.devUser]);

  useEffect(() => {
    if (!referral || referral.grantedRewards <= 0) return;
    try {
      const key = `moti-referral-granted:${referral.code}`;
      const seen = Number(window.localStorage.getItem(key) ?? "0");
      if (!(referral.grantedRewards > seen) || referral.unspentRewards <= 0) return;
      track("referral_reward_ready", { unspent: referral.unspentRewards });
      window.localStorage.setItem(key, String(referral.grantedRewards));
    } catch {
      // Private mode can block storage. The event still fires once this load.
    }
  }, [referral]);

  function tryFromWelcome(id: GuideTry) {
    const first = !catalog?.onboardingDone;
    cacheOnboardingDone();
    setCatalog((current) => (current ? { ...current, onboardingDone: true } : current));
    if (first) track("onboarding_completed");
    void markOnboardingDone().catch(() => undefined);
    if (id === "moti") {
      setScreen({ name: "home" });
      return;
    }
    if (id === "words") {
      setScreen({ name: "dictionary" });
      return;
    }
    if (id === "path") {
      setScreen({ name: "stats" });
      return;
    }
    const theme = practiceTheme(catalog?.themes ?? []);
    if (theme) openTheme(theme, "home");
    else setScreen({ name: "list", section: "words" });
  }

  function openLegal(doc: LegalDoc) {
    setScreen((current) => {
      if (current && current.name !== "legal") legalFromRef.current = current;
      return { name: "legal", doc };
    });
    openLegalUrl(doc);
  }

  function closeLegal() {
    clearLegalUrl();
    const previous = legalFromRef.current;
    legalFromRef.current = null;
    if (previous) {
      setScreen(previous);
      return;
    }
    if (catalog && pet) {
      setScreen({ name: "home" });
      return;
    }
    setScreen(null);
  }

  const goBackRef = useRef<() => void>(() => undefined);
  const backLockRef = useRef(false);
  goBackRef.current = () => {
    if (backLockRef.current) return;
    const current = screenRef.current;
    if (!current || current.name === "home" || current.name === "welcome" || current.name === "first-session") return;
    backLockRef.current = true;
    const releaseBack = () => {
      window.setTimeout(() => {
        backLockRef.current = false;
      }, 500);
    };
    if (current.name === "legal") {
      closeLegal();
      releaseBack();
      return;
    }
    if (current.name === "series") {
      backFromSeries();
      releaseBack();
      return;
    }
    if (current.name === "theme") {
      backFromTheme();
      releaseBack();
      return;
    }
    if (current.name === "words" || current.name === "known" || current.name === "session") {
      const next = { name: "theme" as const, theme: current.theme };
      screenRef.current = next;
      setScreen(next);
      releaseBack();
      return;
    }
    if (current.name === "exam") {
      const flush = examFlushRef.current;
      void (async () => {
        try {
          await flush?.();
          const next = { name: "studying" as const };
          screenRef.current = next;
          setScreen(next);
          void refresh().then(replaceCatalog).catch((err: Error) => setError(visibleError(err)));
        } catch (err) {
          setError(visibleError(err));
        } finally {
          releaseBack();
        }
      })();
      return;
    }
    if (current.name === "referral-pick") {
      const next = { name: "referral" as const };
      screenRef.current = next;
      setScreen(next);
      releaseBack();
      return;
    }
    if (current.name === "paywall") {
      closePaywall(current);
      releaseBack();
      return;
    }
    goHome();
    releaseBack();
  };

  useEffect(() => {
    const name = screen?.name;
    const show = Boolean(name && name !== "home" && name !== "welcome" && name !== "first-session");
    setTelegramBackHandler(show ? () => goBackRef.current() : null);
  }, [screen?.name]);

  useEffect(() => {
    if (screen?.name !== "paywall") return;
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      void loadThemes()
        .then((next) => {
          replaceCatalog(next);
          if (!next.subscribed) return;
          const current = screenRef.current;
          if (current?.name !== "paywall") return;
          closePaywallRef.current(current);
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [screen?.name]);

  useEffect(() => {
    if (window.Telegram?.WebApp) return;
    function syncLegalRoute() {
      const doc = readLegalDoc();
      if (doc) {
        setScreen((current) => {
          if (current && current.name !== "legal") legalFromRef.current = current;
          return { name: "legal", doc };
        });
        return;
      }
      setScreen((current) => {
        if (current?.name !== "legal") return current;
        return legalFromRef.current ?? (catalog && pet ? { name: "home" } : null);
      });
      legalFromRef.current = null;
    }
    window.addEventListener("hashchange", syncLegalRoute);
    window.addEventListener("popstate", syncLegalRoute);
    return () => {
      window.removeEventListener("hashchange", syncLegalRoute);
      window.removeEventListener("popstate", syncLegalRoute);
    };
  }, [catalog, pet]);

  function goHome() {
    setReturnTo("home");
    setOpenShowId(null);
    const next = { name: "home" as const };
    screenRef.current = next;
    setScreen(next);
    void refresh().catch((err: Error) => setError(visibleError(err)));
  }

  function closePaywall(current: Extract<Screen, { name: "paywall" }>) {
    if (current.from === "first-session") {
      const next = { name: "first-session" as const };
      screenRef.current = next;
      setScreen(next);
      return;
    }
    if (current.reason === "teachers" || current.from === "home") {
      goHome();
      return;
    }
    backFromCatalog();
  }
  closePaywallRef.current = closePaywall;

  function openPaywall(extra?: { theme?: ThemeSummary; reason?: "teachers"; from?: "home" | "first-session"; step?: 9 | 15 }) {
    const next = { name: "paywall" as const, ...extra };
    screenRef.current = next;
    setScreen(next);
  }

  function mediaThemesFrom(data: ThemesResponse | null): ThemeSummary[] {
    return data?.blocks.find((block) => block.id === "media")?.themes ?? [];
  }

  function openTheme(theme: ThemeSummary, from: ReturnTo = "home") {
    setReturnTo(from);
    if (theme.kind === "series") {
      setOpenShowId(theme.showId ?? theme.id.replace(/^show:/, ""));
      setScreen(theme.locked ? { name: "paywall", theme } : { name: "series", show: theme });
      return;
    }
    if (theme.kind === "episode") {
      setOpenShowId(theme.showId ?? episodeMeta(theme).showId);
    } else {
      setOpenShowId(null);
    }
    setScreen(theme.locked ? { name: "paywall", theme } : { name: "theme", theme });
  }

  function backFromTheme() {
    if (openShowId) {
      const show = findSeries(mediaThemesFrom(catalog), openShowId);
      if (show) {
        const next = { name: "series" as const, show };
        screenRef.current = next;
        setScreen(next);
        return;
      }
    }
    backToList();
  }

  function backFromSeries() {
    setOpenShowId(null);
    backToList();
  }

  async function removeStudying(theme: ThemeSummary) {
    const ids = studyingPackIds(theme);
    setWordBusyId(theme.id);
    setError(null);
    try {
      await unenrollStudying(ids);
      const skip = new Set(ids);
      setCatalog((current) => {
        if (!current) return current;
        return {
          ...current,
          themes: current.themes.map((item) => (skip.has(item.id) ? { ...item, studying: false } : item)),
          blocks: current.blocks.map((block) => ({
            ...block,
            themes: block.themes.map((item) => (skip.has(item.id) ? { ...item, studying: false } : item)),
          })),
        };
      });
      setScreen((current) => {
        if (current?.name !== "theme" || !skip.has(current.theme.id)) return current;
        return { ...current, theme: { ...current.theme, studying: false } };
      });
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setWordBusyId(null);
    }
  }

  function backFromCatalog() {
    if (returnTo === "texts") {
      void openTexts();
      return;
    }
    if (returnTo === "media" || returnTo === "words") {
      const next = { name: "list" as const, section: returnTo };
      screenRef.current = next;
      setScreen(next);
      return;
    }
    if (returnTo === "studying") {
      const next = { name: "studying" as const };
      screenRef.current = next;
      setScreen(next);
      return;
    }
    goHome();
  }

  async function openMode(
    theme: ThemeSummary,
    mode: SessionMode,
    level: CefrLevel | null = null,
    categoryId: string | null = null,
  ) {
    setLoading(true);
    setError(null);
    try {
      const session = await startSession(theme.id, mode, level, categoryId);
      const studying = theme.knownCount < theme.wordCount;
      const media = theme.kind === "movie" || theme.kind === "episode" || theme.kind === "series";
      if (media) await refresh();
      else {
        setCatalog((current) => {
          if (!current) return current;
          return {
            ...current,
            themes: current.themes.map((item) => (item.id === theme.id ? { ...item, studying } : item)),
            blocks: current.blocks.map((block) => ({
              ...block,
              themes: block.themes.map((item) => (item.id === theme.id ? { ...item, studying } : item)),
            })),
          };
        });
      }
      track("practice_started", {
        theme_id: theme.id,
        mode,
        level: level ?? "",
        word_count: session.words.length,
      });
      const nextTheme = { ...theme, studying, claimable: false, freePick: media };
      if (mode === "control" || mode === "review") {
        setScreen({ name: "session", theme: nextTheme, mode, session });
      } else {
        setScreen({ name: "known", theme: nextTheme, mode, session });
      }
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "subscription_required") setScreen({ name: "paywall", theme });
      else if (code === "empty_level") setError("На этом уровне пока нет слов для изучения");
      else setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  async function confirmKnown(theme: ThemeSummary, mode: SessionMode, session: SessionResponse, knownIds: string[]) {
    setLoading(true);
    setError(null);
    try {
      if (knownIds.length > 0) {
        const result = await postProgress(knownProgressItems(session.themeId, knownIds));
        if (result?.pet) rememberPet(result.pet, result);
      }
      if (knownIds.length === session.words.length) {
        await finishSession(theme.id);
        return;
      }
      setScreen({
        name: "session",
        theme,
        mode,
        session: filterKnownFromSession(session, new Set(knownIds)),
      });
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  function backToList() {
    const dest = returnTo;
    backFromCatalog();
    if (dest === "home" || dest === "texts") return;
    void refresh().catch((err: Error) => setError(visibleError(err)));
  }

  async function finishExam() {
    const data = await refresh();
    replaceCatalog(data);
    setScreen({ name: "studying" });
  }

  async function finishSession(themeId: string) {
    const data = await refresh();
    const theme = data.themes.find((item) => item.id === themeId);
    setScreen(theme ? { name: "theme", theme } : { name: "home" });
  }

  async function onPetAction(action: PetAction) {
    setLoading(true);
    setError(null);
    try {
      const next = await petAction(action);
      rememberPet(next.pet);
      setDailyFact(next.fact);
      track("pet_cared", { action });
      noteGuideTry("moti");
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "no_coins") setError("Не хватает монет");
      else if (code === "pet_unavailable") setError("Сейчас Моти нельзя помочь так");
      else setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  async function openWordList(
    theme: ThemeSummary,
    level: CefrLevel | null,
    categoryId: string | null = null,
  ) {
    setLoading(true);
    setError(null);
    try {
      const list = await loadThemeWords(theme.id, level, categoryId);
      setScreen({ name: "words", theme, level, list });
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "subscription_required") setScreen({ name: "paywall", theme });
      else setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  async function toggleWordKnown(word: ThemeWordListItem, known: boolean) {
    if (screen?.name !== "words") return;
    const themeId = screen.theme.id;
    setWordBusyId(word.id);
    setError(null);
    try {
      const result = await setWordKnown(themeId, word.id, known);
      if (result.pet) rememberPet(result.pet, result);
      const data = await loadThemes();
      replaceCatalog(data);
      const refreshed = data.themes.find((item) => item.id === themeId);
      setScreen((current) => {
        if (current?.name !== "words" || current.theme.id !== themeId) return current;
        const words = current.list.words.map((item) =>
          item.id === word.id ? { ...item, known } : item,
        );
        return {
          ...current,
          theme: refreshed ?? current.theme,
          list: {
            ...current.list,
            words,
            knownCount: words.filter((item) => item.known).length,
          },
        };
      });
      if (known) noteGuideTry("study");
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setWordBusyId(null);
    }
  }

  async function markVisibleKnown(words: ThemeWordListItem[]) {
    if (screen?.name !== "words" || markingAll) return;
    const themeId = screen.theme.id;
    const pending = words.filter((word) => !word.known);
    if (pending.length === 0) return;
    const ids = new Set(pending.map((word) => word.id));
    setMarkingAll(true);
    setError(null);
    try {
      const result = await postProgress(
        pending.map((word) => ({
          wordId: word.id,
          themeId,
          correct: 0,
          wrong: 0,
          known: true,
          awardCoins: false,
          knownOn: localDate(),
        })),
      );
      if (result?.pet) rememberPet(result.pet, result);
      const data = await loadThemes();
      replaceCatalog(data);
      const refreshed = data.themes.find((item) => item.id === themeId);
      setScreen((current) => {
        if (current?.name !== "words" || current.theme.id !== themeId) return current;
        const nextWords = current.list.words.map((item) =>
          ids.has(item.id) ? { ...item, known: true } : item,
        );
        return {
          ...current,
          theme: refreshed ?? current.theme,
          list: {
            ...current.list,
            words: nextWords,
            knownCount: nextWords.filter((item) => item.known).length,
          },
        };
      });
      noteGuideTry("study");
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setMarkingAll(false);
    }
  }

  async function openTexts() {
    setAnalyzeReady(false);
    setError(null);
    if (textsData) setScreen({ name: "texts", data: textsData });
    setLoading(!textsData);
    try {
      const data = await loadTexts();
      setTextsData(data);
      setScreen({ name: "texts", data });
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  async function analyzeDrafts(texts: { title?: string; body: string }[]) {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeReady(false);
    setError(null);
    try {
      const data = await analyzeUserTexts(texts);
      setTextsData(data);
      setScreen((current) => (current?.name === "texts" ? { name: "texts", data } : current));
      if (screenRef.current?.name !== "texts") setAnalyzeReady(true);
      const catalogData = await loadThemes();
      replaceCatalog(catalogData);
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function removeText(id: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await deleteUserText(id);
      setTextsData(data);
      setScreen({ name: "texts", data });
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  function openRecommended(theme: ThemeSummary) {
    openTheme(theme, "texts");
  }

  function analyzedTextIds(data: TextsResponse): string[] {
    if (data.analysis?.textIds && data.analysis.textIds.length > 0) return data.analysis.textIds;
    return data.texts[0] ? [data.texts[0].id] : [];
  }

  function isAnalyzedTextStudying(data: TextsResponse): boolean {
    const ids = analyzedTextIds(data);
    const themes = catalog?.themes ?? [];
    return (
      ids.length > 0 && ids.every((id) => themes.some((theme) => theme.id === `text:${id}` && theme.studying))
    );
  }

  function markStudying(themeId: string) {
    setCatalog((current) => {
      if (!current) return current;
      return {
        ...current,
        themes: current.themes.map((item) => (item.id === themeId ? { ...item, studying: true } : item)),
        blocks: current.blocks.map((block) => ({
          ...block,
          themes: block.themes.map((item) => (item.id === themeId ? { ...item, studying: true } : item)),
        })),
      };
    });
  }

  async function addStudying(theme: ThemeSummary) {
    if (theme.locked) {
      setReturnTo("texts");
      setScreen({ name: "paywall", theme });
      return;
    }
    setWordBusyId(theme.id);
    setError(null);
    try {
      await enrollStudying([theme.id]);
      markStudying(theme.id);
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setWordBusyId(null);
    }
  }

  async function addTextStudying(data: TextsResponse) {
    const themeIds = analyzedTextIds(data).map((id) => `text:${id}`);
    if (themeIds.length === 0) return;
    setWordBusyId("text");
    setError(null);
    try {
      await enrollStudying(themeIds);
      await refresh();
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setWordBusyId(null);
    }
  }

  function showTeachers(loaded: Awaited<ReturnType<typeof loadTeachers>>) {
    setScreen({
      name: "teachers",
      teachers: loaded.teachers,
      locked: false,
      admin: loaded.admin,
      listed: loaded.listed,
      ownProfile: loaded.ownProfile,
      account: loaded.account,
      teachLanguages: loaded.teachLanguages,
    });
  }

  async function openTeachers() {
    setLoading(true);
    setError(null);
    try {
      showTeachers(await loadTeachers());
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveTeacher(input: { name: string; telegramUsername: string; bio: string }): Promise<string | null> {
    const result = await createTeacher(input);
    showTeachers(await loadTeachers());
    return result.warning;
  }

  async function reloadTeacherPhoto(id: string): Promise<string | null> {
    const result = await refreshTeacherPhoto(id);
    showTeachers(await loadTeachers());
    return result.warning;
  }

  async function removeTeacher(id: string) {
    await deleteTeacher(id);
    showTeachers(await loadTeachers());
  }

  async function leaveOwnTeacher() {
    await leaveTeacherList();
    const [loaded, data] = await Promise.all([loadTeachers(), loadThemes()]);
    replaceCatalog(data);
    showTeachers(loaded);
  }

  if (screen?.name === "legal") {
    return (
      <div className="app">
        <LegalScreen doc={screen.doc} onBack={closeLegal} onOpen={openLegal} />
      </div>
    );
  }

  if (!catalog || !pet || !screen || !motiReady) {
    return (
      <div className="app">
        <h1>Моти</h1>
        <p>{error ?? "Загрузка…"}</p>
      </div>
    );
  }

  const languageCaps = me ? languageProfile(me) : undefined;
  const showDevBanner =
    catalog.devUser && !isInsideTelegram() && screen.name !== "welcome" && screen.name !== "first-session";
  const showCatalogBar = screen.name === "home";
  const showAccessBanner = screen.name === "home" && !catalog.subscribed;

  return (
    <div className="app">
      {showCatalogBar ? (
        <CatalogBar
          count={catalog.catalogWordCount}
          language={me?.language ?? catalog.language}
          languageTitle={languageCaps?.title ?? "Английский"}
          subscribed={catalog.subscribed}
          onOpenLanguage={() => setScreen({ name: "language", from: "settings" })}
        />
      ) : null}

      {showDevBanner ? (
        <div className="dev-banner">Браузерный режим: тестовый пользователь без Telegram initData</div>
      ) : null}

      {showAccessBanner ? (
        <AccessBanner
          subscribed={catalog.subscribed}
          texts={languageCaps?.texts !== false}
          onOpen={() => openPaywall({ from: "home" })}
        />
      ) : null}

      {analyzing && screen.name !== "texts" ? (
        <button type="button" className="analyze-toast" onClick={() => void openTexts()}>
          Разбираем текст… можно открыть статус
        </button>
      ) : null}

      {screen.name === "language" ? (
        <LanguagePick
          languages={me?.languages ?? []}
          busy={loading}
          title={screen.from === "settings" ? "Язык" : "Какой язык учим?"}
          onChoose={(code) => void chooseLanguage(code)}
          onBack={screen.from === "settings" ? () => setScreen({ name: "home" }) : undefined}
        />
      ) : null}

      {screen.name === "voice" ? (
        <VoicePick
          lang={languageCaps?.voice ?? "en-US"}
          languageTitle={languageCaps?.title ?? "Английский"}
          onBack={goHome}
        />
      ) : null}

      {screen.name === "welcome" ? (
        <Welcome
          replay={catalog.onboardingDone}
          onStart={() => dismissOnboarding("home")}
          onWords={() => dismissOnboarding("list")}
          onSkip={() => dismissOnboarding("home")}
          onTry={tryFromWelcome}
          onOpenLegal={openLegal}
        />
      ) : null}

      {screen.name === "first-session" ? (
        <FirstSessionFlow
          me={me}
          catalog={catalog}
          pet={pet}
          onSyncMe={applyMe}
          onSyncCatalog={replaceCatalog}
          onSyncPet={rememberPet}
          onOpenLegal={openLegal}
          onOpenPaywall={(step) => openPaywall({ from: "first-session", step })}
          onComplete={() => dismissOnboarding("home")}
          inviteUrl={referral?.inviteUrl ?? ""}
        />
      ) : null}

      {screen.name === "home" && referral ? (
        <HomeFeed
          pet={pet}
          referral={referral}
          fact={dailyFact}
          coinsFlash={coinsFlash}
          rescued={rescued}
          rescuePlay={rescuePlay}
          busy={loading}
          onCoinsSeen={() => setCoinsFlash(0)}
          onRescueSeen={() => setRescuePlay(false)}
          subscribed={catalog.subscribed}
          blocks={catalog.blocks}
          themes={catalog.themes}
          onAction={(action) => void onPetAction(action)}
          onTeachers={() => void openTeachers()}
          onOpenTheme={(theme) => openTheme(theme, "home")}
          onOpenMedia={() => setScreen({ name: "list", section: "media" })}
          onOpenWords={() => setScreen({ name: "list", section: "words" })}
          onOpenTexts={() => void openTexts()}
          onOpenStudying={() => setScreen({ name: "studying" })}
          onOpenStats={() => setScreen({ name: "stats" })}
          onOpenDictionary={() => setScreen({ name: "dictionary" })}
          showDictionary={languageCaps?.dictionary !== false}
          showTexts={languageCaps?.texts !== false}
          voiceLang={languageCaps?.voice ?? "en-US"}
          onOpenVoice={() => setScreen({ name: "voice" })}
          onOpenGuide={openGuide}
          onOpenReferral={() => {
            const next = { name: "referral" as const };
            screenRef.current = next;
            setScreen(next);
          }}
          guideTries={catalog.guideTries ?? []}
          onOpenLegal={openLegal}
          analyzing={analyzing}
          analyzeReady={analyzeReady}
          extra={
            me?.wordtronPreview ? (
              <Suspense fallback={null}>
                <HiddenHomeEntry onOpen={() => setScreen({ name: "aside" })} />
              </Suspense>
            ) : null
          }
        />
      ) : null}

      {screen.name === "referral" && referral && catalog ? (
        <div className="referral-screen">
          <ReferralExplain
            inviteUrl={referral.inviteUrl}
            source="home"
            subscribed={catalog.subscribed}
            unspentRewards={referral.unspentRewards}
            pendingInvites={referral.pendingInvites}
            onPick={
              !catalog.subscribed && referral.unspentRewards > 0
                ? () => {
                    const next = { name: "referral-pick" as const };
                    screenRef.current = next;
                    setScreen(next);
                  }
                : undefined
            }
            onBack={goHome}
          />
        </div>
      ) : null}

      {screen.name === "referral-pick" && referral ? (
        <ReferralPicker
          inviteUrl={referral.inviteUrl}
          onBack={() => {
            const next = { name: "referral" as const };
            screenRef.current = next;
            setScreen(next);
          }}
          onClaimed={() => {
            goHome();
          }}
        />
      ) : null}

      {screen.name === "stats" ? (
        <StatsScreen
          onBack={goHome}
          extra={
            me?.wordtronPreview ? (
              <Suspense fallback={null}>
                <HiddenStats onOpen={() => setScreen({ name: "aside" })} />
              </Suspense>
            ) : null
          }
        />
      ) : null}

      {screen.name === "aside" ? (
        <Suspense fallback={<p>Загрузка…</p>}>
          <HiddenScreen onBack={goHome} />
        </Suspense>
      ) : null}

      {screen.name === "dictionary" ? (
        <DictionaryScreen
          onBack={goHome}
          onKnown={(result, known) => {
            if (result.pet) rememberPet(result.pet, result);
            if (known) noteGuideTry("study");
            void loadThemes().then(replaceCatalog).catch(() => undefined);
          }}
          onStudied={() => {
            void loadThemes().then(replaceCatalog).catch(() => undefined);
          }}
        />
      ) : null}

      {screen.name === "studying" ? (
        <StudyingScreen
          themes={catalog.themes}
          busyId={wordBusyId}
          showTexts={languageCaps?.texts !== false}
          subscribed={catalog.subscribed}
          onBack={goHome}
          onOpen={(theme) => openTheme(theme, "studying")}
          onRemove={(theme) => void removeStudying(theme)}
          onOpenFilms={() => setScreen({ name: "list", section: "media" })}
          onOpenWords={() => setScreen({ name: "list", section: "words" })}
          onOpenTexts={() => void openTexts()}
        />
      ) : null}

      {screen.name === "series" ? (
        <SeriesScreen
          show={findSeries(mediaThemesFrom(catalog), screen.show.showId ?? openShowId ?? "") ?? screen.show}
          busy={wordBusyId === (screen.show.id ?? openShowId)}
          subscribed={catalog.subscribed}
          onBack={backFromSeries}
          onOpen={(theme) => openTheme(theme, returnTo)}
          onRemoveStudying={(theme) => void removeStudying(theme)}
        />
      ) : null}

      {screen.name === "list" ? (
        <>
          <ScreenHeader
            title={screen.section === "media" ? "Кино и сериалы" : "Темы"}
            onBack={goHome}
          />
          <p>
            {screen.section === "media"
              ? catalog.subscribed
                ? "Выбери фильм или сериал. Серии открываются внутри карточки."
                : "Бесплатно — один фильм или сериал. «Учить» закрепляет этот выбор."
              : catalog.subscribed
                ? "Темы по блокам. В каждой — слова A1–C2."
                : "10 тем бесплатно. Остальные — по подписке."}
          </p>
          <ThemeList
            blocks={catalog.blocks}
            themes={catalog.themes}
            section={screen.section}
            showTitles={screen.section !== "media"}
            subscribed={catalog.subscribed}
            onOpen={(theme) => openTheme(theme, screen.section)}
            mediaRequests={languageCaps?.mediaRequests !== false}
          />
        </>
      ) : null}

      {screen.name === "texts" ? (
        <TextsScreen
          data={screen.data}
          themes={catalog.themes}
          busy={loading}
          analyzing={analyzing}
          enrollBusyId={wordBusyId}
          textStudying={isAnalyzedTextStudying(screen.data)}
          subscribed={catalog.subscribed}
          onBack={goHome}
          onAnalyze={(texts) => void analyzeDrafts(texts)}
          onDelete={(id) => void removeText(id)}
          onOpenTheme={openRecommended}
          onLearnText={() => void addTextStudying(screen.data)}
          onLearnTheme={(theme) => void addStudying(theme)}
        />
      ) : null}

      {screen.name === "teachers" ? (
        <TeachersFeed
          teachers={screen.teachers}
          locked={screen.locked}
          admin={screen.admin}
          languageTitle={languageCaps?.title}
          listed={screen.listed}
          ownProfile={screen.ownProfile}
          teachLanguages={screen.teachLanguages}
          account={screen.account}
          onBack={goHome}
          onOpenAccess={() => openPaywall({ reason: "teachers" })}
          onCreate={saveTeacher}
          onDelete={removeTeacher}
          onLeave={leaveOwnTeacher}
          onRefreshPhoto={reloadTeacherPhoto}
        />
      ) : null}

      {screen.name === "theme" ? (
        <ThemeScreen
          theme={screen.theme}
          busy={wordBusyId === screen.theme.id}
          onBack={backFromTheme}
          onMode={(mode, level, categoryId) => void openMode(screen.theme, mode, level, categoryId)}
          onWordList={(level, categoryId) => void openWordList(screen.theme, level, categoryId)}
          onRemoveStudying={(theme) => void removeStudying(theme)}
        />
      ) : null}

      {screen.name === "words" ? (
        <WordList
          list={screen.list}
          language={me?.language ?? catalog.language}
          busyId={wordBusyId}
          markingAll={markingAll}
          onBack={() => setScreen({ name: "theme", theme: screen.theme })}
          onToggle={(word, known) => void toggleWordKnown(word, known)}
          onMarkAll={(words) => void markVisibleKnown(words)}
        />
      ) : null}

      {screen.name === "paywall" ? (
        <Paywall
          theme={screen.theme}
          reason={screen.reason}
          subscribeUrl={catalog.subscribeUrl}
          subscribeYearlyUrl={catalog.subscribeYearlyUrl}
          source={paywallSource(screen)}
          onBack={() => closePaywall(screen)}
          onOpenLegal={openLegal}
        />
      ) : null}

      {screen.name === "known" ? (
        <KnownMark
          session={screen.session}
          mode={screen.mode}
          busy={loading}
          onBack={() => setScreen({ name: "theme", theme: screen.theme })}
          onConfirm={(knownIds) => void confirmKnown(screen.theme, screen.mode, screen.session, knownIds)}
        />
      ) : null}

      {screen.name === "exam" ? (
        <Exam
          words={screen.words}
          onBindFlush={bindExamFlush}
          onProgress={(result) => {
            if (result.pet) rememberPet(result.pet, result);
          }}
          onDone={() => void finishExam()}
        />
      ) : null}

      {screen.name === "session" ? (
        screen.mode === "learn" ? (
          <Learn
            session={screen.session}
            motiCoins={pet?.coins ?? null}
            onDone={() => void finishSession(screen.theme.id)}
          />
        ) : screen.mode === "match" ? (
          <Match
            session={screen.session}
            motiCoins={pet?.coins ?? null}
            onDone={() => void finishSession(screen.theme.id)}
          />
        ) : (
          <Recall session={screen.session} onDone={() => void finishSession(screen.theme.id)} />
        )
      ) : null}

      {loading ? (
        <p>
          {screen.name === "known"
            ? "Сохраняем…"
            : screen.name === "home"
              ? "Загрузка…"
              : "Собираем слова…"}
        </p>
      ) : null}
      {error ? <p className="feedback bad">{error}</p> : null}
    </div>
  );
}
