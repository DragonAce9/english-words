export type SessionMode = "learn" | "match" | "control" | "review";
/** `en` is the language being studied. Values stay `en-ru` / `ru-en`. */
export type Direction = "en-ru" | "ru-en";
export type WordGender = "m" | "f" | "n" | "m/f";

export interface LanguageOption {
  code: string;
  title: string;
  voice: string;
  dictionary: boolean;
  texts: boolean;
  mediaRequests: boolean;
}

export interface MeResponse {
  language: string;
  languageChosen: boolean;
  languages: LanguageOption[];
  activeLanguage?: LanguageOption;
  wordtronPreview?: boolean;
}
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface LevelCounts {
  A1: number;
  A2: number;
  B1: number;
  B2: number;
  C1: number;
  C2: number;
}

export interface ThemeCategorySummary {
  id: string;
  title: string;
  wordCount: number;
  knownCount: number;
  levels: LevelCounts;
  knownByLevel: LevelCounts;
}

export interface ThemeSummary {
  id: string;
  title: string;
  blockId: string;
  wordCount: number;
  knownCount: number;
  paid: boolean;
  locked: boolean;
  claimable?: boolean;
  freePick?: boolean;
  referralPick?: boolean;
  studying: boolean;
  levels: LevelCounts;
  knownByLevel: LevelCounts;
  posterUrl?: string | null;
  kind?: "movie" | "episode" | "series" | "text";
  year?: number | null;
  showId?: string | null;
  showTitle?: string | null;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  episodes?: ThemeSummary[];
  categories?: ThemeCategorySummary[];
}

export interface ThemeBlockSummary {
  id: string;
  title: string;
  order: number;
  themes: ThemeSummary[];
}

export interface ThemesResponse {
  themes: ThemeSummary[];
  blocks: ThemeBlockSummary[];
  catalogWordCount: number;
  subscribed: boolean;
  listedTeacher?: boolean;
  subscribeUrl: string;
  subscribeYearlyUrl?: string;
  botUsername?: string;
  devUser: boolean;
  onboardingDone: boolean;
  guideTries: GuideTry[];
  language?: string;
  languageChosen?: boolean;
  languages?: LanguageOption[];
  activeLanguage?: LanguageOption;
}

export type GuideTry = "moti" | "study" | "words" | "path";

export interface SessionWord {
  id: string;
  word?: string;
  en: string;
  ru: string[];
  example: string;
  level: CefrLevel;
  pos?: string;
  gender?: WordGender;
  wordCyrillic?: string;
  source?: string;
  status: "new" | "learning" | "known";
}

export interface McChoice {
  wordId: string;
  direction: Direction;
  options: string[];
  answer: string;
}

export interface MatchPair {
  id: string;
  word?: string;
  en: string;
  ru: string;
}

export interface ExamResponse {
  words: SessionWord[];
}

export interface FirstSessionSampleWord {
  id: string;
  word: string;
  ru: string[];
  level: CefrLevel;
}

export interface FirstSessionPack {
  session: SessionResponse;
  dictionaryTarget: FirstSessionSampleWord | null;
}

export interface SessionResponse {
  themeId: string;
  mode: SessionMode;
  level: CefrLevel | null;
  categoryId: string | null;
  words: SessionWord[];
  choices: McChoice[];
  matchRounds: MatchPair[][];
}

export interface ProgressItem {
  wordId: string;
  themeId: string;
  correct: number;
  wrong: number;
  known: boolean;
  /** When false, becoming known does not grant Moti coins. Omitted keeps the coin award. */
  awardCoins?: boolean;
  /** User-local calendar day (YYYY-MM-DD) when this save marks the word known. */
  knownOn?: string;
  /** Exam miss: return the word to study even if it was already known. */
  demote?: boolean;
  /** Exam pass: both directions were correct, so the word counts as confirmed. */
  examined?: boolean;
}

export interface WordStats {
  correct: number;
  wrong: number;
  known: boolean;
}

export type PetStatus = "alive" | "suffering" | "cryo" | "graduated";
export type PetAction = "feed" | "play";

export interface PetSnapshot {
  coins: number;
  hunger: number;
  mood: number;
  home: number;
  study: number;
  status: PetStatus;
  lastTickAt: string;
  sufferingStartedAt: string | null;
  cryoAt: string | null;
  graduatedAt: string | null;
  knownCount: number;
  totalWords: number;
  actionCost: number;
  coinsPerKnownWord: number;
  coinsPerInvite: number;
}

export interface DailyFact {
  day: string;
  body: string;
}

export interface ReferralSummary {
  code: string;
  inviteCount: number;
  inviteUrl: string;
  /** Friends who opened the link and have not finished the first session. */
  pendingInvites: number;
  /** Friends who finished the first session. */
  completedInvites: number;
  /** Picks the inviter has not spent. One per completed friend, unless access was already full. */
  unspentRewards: number;
  /** Completed invites that created a pick (ready or already claimed). */
  grantedRewards: number;
}

export interface ProgressResult {
  ok?: boolean;
  updated: number;
  coinsEarned: number;
  rescued: boolean;
  pet: PetSnapshot;
}

export interface TeacherCard {
  id: string;
  name: string;
  telegramUsername: string;
  telegramUserId: number | null;
  bio: string;
  photoUrl: string | null;
}

export interface ThemeWordListItem {
  id: string;
  word?: string;
  en: string;
  ru: string[];
  example: string;
  level: CefrLevel;
  pos?: string;
  gender?: WordGender;
  wordCyrillic?: string;
  known: boolean;
}

export interface ThemeWordListResponse {
  themeId: string;
  title: string;
  level: CefrLevel | null;
  categoryId: string | null;
  knownCount: number;
  words: ThemeWordListItem[];
}

export interface SavedText {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface ThemeRecommendation {
  themeId: string;
  title: string;
  locked: boolean;
  inText: number;
  known: number;
  unknown: number;
  added: number;
  sample: string[];
}

export interface TextAnalysis {
  uniqueWords: number;
  matched: number;
  added: number;
  skipped: number;
  usedAi: boolean;
  textIds?: string[];
  recommendations: ThemeRecommendation[];
  addedWords: { id: string; en: string; ru: string[]; themeId: string; themeTitle: string }[];
}

export interface TextQuota {
  maxTexts: number;
  maxChars: number;
  used: number;
  /** Paid tier: new texts allowed per rolling window. null on the free tier. */
  monthlyLimit?: number | null;
  monthlyUsed?: number;
  windowDays?: number;
  /** When the next monthly slot frees up (ISO), if the window is full. */
  nextAt?: string | null;
}

export interface TextsResponse {
  texts: SavedText[];
  analysis: TextAnalysis | null;
  quota?: TextQuota;
}

export interface DictionaryHit {
  id: string;
  word?: string;
  en: string;
  gender?: WordGender;
  ru: string[];
  example: string;
  level: CefrLevel;
  pos?: string;
  themeId: string;
  themeTitle: string;
  /** Every catalog category that contains this word, in catalog order. */
  themes: { id: string; title: string }[];
  known: boolean;
  /** Saved with «Учить» for this user. */
  studying: boolean;
  /** Infinitive, past, and participle for an irregular verb. */
  forms?: [string, string, string];
  /** Set when the gloss comes from outside the app catalog. */
  source?: string;
}

export interface DictionarySearch {
  query: string;
  exact: boolean;
  added: boolean;
  corrected: boolean;
  hits: DictionaryHit[];
  alternatives: DictionaryHit[];
}

export interface UserStatsDay {
  day: string;
  label: string;
  count: number;
}

export interface UserStatsLevel {
  level: CefrLevel;
  known: number;
  total: number;
}

export interface UserStatsTheme {
  id: string;
  title: string;
  known: number;
  total: number;
}

export interface UserStats {
  known: number;
  /** Known words whose latest exam was a pass. */
  examined: number;
  total: number;
  learning: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
  coins: number;
  streak: number;
  activeDays: number;
  week: UserStatsDay[];
  levels: UserStatsLevel[];
  themes: UserStatsTheme[];
}
