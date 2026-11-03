export type WordStatus = "learning" | "known";
export type SessionMode = "learn" | "match" | "control" | "review";
export type SubscriptionPeriod = "monthly" | "yearly";
export type SubscriptionType = "regular" | "gift" | "trial";
/**
 * `en` is the language being studied and `ru` is Russian.
 * The values stay `en-ru` / `ru-en` so older clients keep working.
 */
export type Direction = "en-ru" | "ru-en";
export type WordGender = "m" | "f" | "n" | "m/f";
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type WordPos =
  | "n"
  | "v"
  | "adj"
  | "adv"
  | "numeral"
  | "pronoun"
  | "determiner"
  | "preposition"
  | "conjunction"
  | "interjection";

export const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface DictWord {
  id: string;
  /** Headword in the language being studied. For English this is the same string as `en`. */
  word?: string;
  /** Target-language headword kept for older clients. For English, `word === en`. */
  en: string;
  ru: string[];
  example: string;
  level: CefrLevel;
  /** Part of speech for this listing. The same headword can be a noun in one theme and a verb in another. */
  pos?: WordPos;
  /** English catalog id this card was translated from. */
  sourceId?: string;
  sourceIds?: string[];
  gender?: WordGender;
  /** Serbian headword in Cyrillic. The studied form stays Latin in `word`. */
  wordCyrillic?: string;
  /** Film example was translated into the studied language. Shown as a normal example. */
  exampleTranslated?: boolean;
  /** Where the gloss and example came from, when it is not the app catalog. */
  source?: string;
}

export interface DictTheme {
  id: string;
  title: string;
  paid: boolean;
  blockId: string;
  words: DictWord[];
  posterUrl?: string | null;
  kind?: "movie" | "episode" | "text";
  year?: number | null;
  showId?: string | null;
  showTitle?: string | null;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
}

export interface DictBlock {
  id: string;
  title: string;
  order: number;
  themeIds: string[];
}

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
  /** Extra collection from a completed invite. Does not use the free film slot. */
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

/** Block list sent to the client. Theme bodies live once in `themes`. */
export interface ThemeBlockWire {
  id: string;
  title: string;
  order: number;
  themeIds: string[];
}

export interface ThemeWordListItem {
  id: string;
  word?: string;
  en: string;
  ru: string[];
  example: string;
  level: CefrLevel;
  pos?: WordPos;
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

export interface SessionWord {
  id: string;
  word?: string;
  en: string;
  ru: string[];
  example: string;
  level: CefrLevel;
  pos?: WordPos;
  gender?: WordGender;
  wordCyrillic?: string;
  source?: string;
  status: "new" | WordStatus;
}

export interface MatchPair {
  id: string;
  word?: string;
  en: string;
  ru: string;
}

export interface McChoice {
  wordId: string;
  direction: Direction;
  options: string[];
  answer: string;
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
  themeId?: string;
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

export interface AppUser {
  id: string;
  telegramUserId: number;
  telegramUsername: string | null;
  /** Avatar URL from Telegram init data, when the Mini App sent one. */
  photoUrl?: string | null;
  subscribed: boolean;
  freeMediaId: string | null;
  /** Extra collections opened by referral picks, for the active language. */
  referralUnlocks?: readonly string[];
  dev: boolean;
  onboardingDone: boolean;
  language: string;
  languageChosen: boolean;
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

export interface ProgressResult {
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
  textIds: string[];
  recommendations: ThemeRecommendation[];
  addedWords: { id: string; en: string; ru: string[]; themeId: string; themeTitle: string }[];
}

export interface TextQuota {
  maxTexts: number;
  maxChars: number;
  used: number;
  monthlyLimit: number | null;
  monthlyUsed: number;
  windowDays: number;
  nextAt: string | null;
}

export interface TextsResponse {
  texts: SavedText[];
  analysis: TextAnalysis | null;
  quota: TextQuota;
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
