import { localDate } from "./localDate";
import { getInitData } from "./telegram";
import type {
  CefrLevel,
  PetAction,
  DailyFact,
  PetSnapshot,
  ReferralSummary,
  ProgressItem,
  ProgressResult,
  ExamResponse,
  FirstSessionPack,
  SessionMode,
  SessionResponse,
  TeacherCard,
  DictionarySearch,
  TextsResponse,
  ThemeSummary,
  ThemeWordListResponse,
  ThemesResponse,
  GuideTry,
  MeResponse,
  UserStats,
} from "./types";

const OPAQUE_ERROR = /^(HTTP \d|Failed to fetch|NetworkError|Load failed|Internal error)/i;

/** Browser fetch failures are English. Keep a real server message, replace the rest. */
export function visibleError(err: unknown, fallback = "Не удалось загрузить. Попробуйте ещё раз."): string {
  const message = err instanceof Error ? err.message.trim() : "";
  if (!message || OPAQUE_ERROR.test(message)) return fallback;
  return message;
}

function authHeaders(): HeadersInit {
  const initData = getInitData();
  if (initData) {
    return {
      Authorization: `tma ${initData}`,
      "X-Telegram-Init-Data": initData,
    };
  }
  return { Authorization: "dev" };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(body.error ?? `HTTP ${response.status}`) as Error & { status: number; code?: string };
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

interface ThemeBlockWire {
  id: string;
  title: string;
  order: number;
  themeIds?: string[];
  themes?: ThemeSummary[];
}

function hydrateThemeBlocks(data: Omit<ThemesResponse, "blocks"> & { blocks: ThemeBlockWire[] }): ThemesResponse {
  const byId = new Map(data.themes.map((theme) => [theme.id, theme]));
  return {
    ...data,
    blocks: data.blocks.map((block) => ({
      id: block.id,
      title: block.title,
      order: block.order,
      themes:
        block.themes ??
        (block.themeIds ?? [])
          .map((id) => byId.get(id))
          .filter((theme): theme is ThemeSummary => theme != null),
    })),
  };
}

export function loadThemes(): Promise<ThemesResponse> {
  return request<Omit<ThemesResponse, "blocks"> & { blocks: ThemeBlockWire[] }>("/themes").then(hydrateThemeBlocks);
}

export function loadMe(): Promise<MeResponse> {
  return request<MeResponse>("/me");
}

export function setMyLanguage(language: string): Promise<MeResponse> {
  return request<MeResponse>("/me/language", {
    method: "POST",
    body: JSON.stringify({ language }),
  });
}

export function markOnboardingDone(): Promise<{ ok: boolean; onboardingDone: boolean }> {
  return request<{ ok: boolean; onboardingDone: boolean }>("/onboarding", { method: "POST" });
}

export function loadFirstSessionPack(): Promise<FirstSessionPack> {
  return request<FirstSessionPack>("/onboarding/session", { method: "POST" });
}

export function markGuideTry(id: GuideTry): Promise<{ tries: GuideTry[] }> {
  return request<{ tries: GuideTry[] }>("/guide", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function startExam(): Promise<ExamResponse> {
  return request<ExamResponse>("/exam", { method: "POST" });
}

export function startSession(
  themeId: string,
  mode: SessionMode,
  level: CefrLevel | null = null,
  categoryId: string | null = null,
): Promise<SessionResponse> {
  return request<SessionResponse>("/sessions", {
    method: "POST",
    body: JSON.stringify({ themeId, mode, level, categoryId, today: localDate() }),
  });
}

export function gradeRecall(input: {
  themeId: string;
  mode: "control" | "review";
  wordId: string;
  answer: string;
  level: CefrLevel | null;
  categoryId: string | null;
}): Promise<{ correct: boolean }> {
  return request<{ correct: boolean }>("/review", {
    method: "POST",
    body: JSON.stringify({ ...input, today: localDate() }),
  });
}

export function enrollStudying(themeIds: string[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/studying", {
    method: "POST",
    body: JSON.stringify({ themeIds }),
  });
}

export function unenrollStudying(themeIds: string[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/studying", {
    method: "DELETE",
    body: JSON.stringify({ themeIds }),
  });
}

export function requestCatalogTitle(body: {
  kind: "movie" | "series";
  title: string;
  comment?: string;
}): Promise<{ ok: boolean; id: string }> {
  return request("/catalog-requests", { method: "POST", body: JSON.stringify(body) });
}

export function reportWord(body: {
  wordId: string;
  themeId: string;
  reason: "translation" | "category" | "sense" | "example";
  comment?: string;
}): Promise<{ ok: boolean; id: string }> {
  return request("/reports", { method: "POST", body: JSON.stringify(body) });
}

export async function postProgress(items: ProgressItem[], keepalive = false): Promise<ProgressResult | void> {
  if (items.length === 0) return;
  if (keepalive) {
    await fetch("/progress", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ items }),
    });
    return;
  }
  return request<ProgressResult>("/progress", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function loadPet(): Promise<{ pet: PetSnapshot; referral: ReferralSummary; fact: DailyFact | null }> {
  return request<{ pet: PetSnapshot; referral: ReferralSummary; fact: DailyFact | null }>("/pet");
}

export interface ReferralChoice {
  id: string;
  title: string;
  kind: "movie" | "series" | "theme";
  year: number | null;
}

export interface ReferralRewards extends ReferralSummary {
  picker: boolean;
  fullAccess: boolean;
  media: ReferralChoice[];
  themes: ReferralChoice[];
}

export function loadReferralRewards(): Promise<ReferralRewards> {
  return request<ReferralRewards>("/referral/rewards");
}

export function claimReferralReward(themeId: string): Promise<{
  ok: boolean;
  themeId: string;
  kind: ReferralChoice["kind"];
  title: string;
  referral: ReferralSummary;
}> {
  return request("/referral/rewards", {
    method: "POST",
    body: JSON.stringify({ themeId }),
  });
}

export async function petAction(action: PetAction): Promise<{ pet: PetSnapshot; fact: DailyFact }> {
  return request<{ pet: PetSnapshot; fact: DailyFact }>("/pet/actions", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export interface TeacherAccount {
  telegramUserId: number;
  telegramUsername: string | null;
}

export interface TeachLanguage {
  code: string;
  title: string;
}

export async function loadTeachers(): Promise<{
  teachers: TeacherCard[];
  admin: boolean;
  listed: boolean;
  ownProfile: boolean;
  teachLanguages: TeachLanguage[];
  account: TeacherAccount;
}> {
  return request("/teachers");
}

export function submitTeacherApplication(input: {
  name: string;
  bio: string;
  languages: string[];
}): Promise<{ ok: true }> {
  return request("/teachers/apply", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createTeacher(input: {
  name: string;
  telegramUsername: string;
  bio: string;
}): Promise<{ teacher: TeacherCard; warning: string | null }> {
  return request<{ teacher: TeacherCard; warning: string | null }>("/teachers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function refreshTeacherPhoto(id: string): Promise<{ teacher: TeacherCard; warning: string | null }> {
  return request<{ teacher: TeacherCard; warning: string | null }>(`/teachers/${encodeURIComponent(id)}/photo`, {
    method: "POST",
  });
}

export function deleteTeacher(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/teachers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function leaveTeacherList(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/teachers/me", { method: "DELETE" });
}

export function loadThemeWords(
  themeId: string,
  level: CefrLevel | null = null,
  categoryId: string | null = null,
): Promise<ThemeWordListResponse> {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (categoryId) params.set("category", categoryId);
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<ThemeWordListResponse>(`/themes/${encodeURIComponent(themeId)}/words${query}`);
}

export function setWordKnown(
  themeId: string,
  wordId: string,
  known: boolean,
): Promise<ProgressResult> {
  return request<ProgressResult>("/progress", {
    method: "POST",
    body: JSON.stringify({
      items: [{ wordId, themeId, correct: 0, wrong: 0, known, knownOn: localDate() }],
    }),
  });
}

export function loadTexts(): Promise<TextsResponse> {
  return request<TextsResponse>("/texts");
}

export function analyzeUserTexts(
  texts: { title?: string; body: string }[],
): Promise<TextsResponse & { analysis: NonNullable<TextsResponse["analysis"]> }> {
  return request("/texts/analyze", {
    method: "POST",
    body: JSON.stringify({ texts }),
  });
}

export function searchDictionary(query: string): Promise<DictionarySearch> {
  return request<DictionarySearch>(`/dictionary?q=${encodeURIComponent(query)}`);
}

export function lookupDictionary(query: string): Promise<DictionarySearch> {
  return request<DictionarySearch>("/dictionary", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export function addStudyWord(wordId: string): Promise<{ wordId: string; studying: boolean }> {
  return request("/dictionary/study", {
    method: "POST",
    body: JSON.stringify({ wordId }),
  });
}

export function loadStats(): Promise<UserStats> {
  return request<UserStats>("/stats");
}

export function deleteUserText(textId: string): Promise<TextsResponse> {
  return request<TextsResponse>(`/texts/${encodeURIComponent(textId)}`, { method: "DELETE" });
}
