import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  for (const path of [resolve(here, "../../../.env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadDotEnv();

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function tributeProductUrl(productId: number, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  return `https://telegram.me/tribute/app?startapp=p${productId}`;
}

const tributeProductMonthlyId = numEnv("TRIBUTE_PRODUCT_MONTHLY_ID", 1001);
const tributeProductYearlyId = numEnv("TRIBUTE_PRODUCT_YEARLY_ID", 1002);
const dictionaryDir = resolve(process.env.DICTIONARY_DIR ?? resolve(here, "../../../data/themes"));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: env("DATABASE_URL", "postgres://english:english@localhost:5432/english"),
  botToken: env("BOT_TOKEN", "123456:replace-me"),
  botUsername: (process.env.BOT_USERNAME ?? "YOUR_BOT_USERNAME").trim().replace(/^@/, ""),
  supportTelegramUserId: Number(process.env.SUPPORT_TELEGRAM_USER_ID ?? "") || 0,
  supportTelegramUsername: (process.env.SUPPORT_TELEGRAM_USERNAME ?? "YOUR_SUPPORT_USERNAME").trim().replace(/^@/, ""),
  webappUrl: env("WEBAPP_URL", "http://localhost:3000"),
  tributeApiKey: env("TRIBUTE_API_KEY", "dev-tribute-key"),
  tributeProductMonthlyId,
  tributeProductYearlyId,
  tributeSubscribeUrl: tributeProductUrl(
    tributeProductMonthlyId,
    process.env.TRIBUTE_SUBSCRIBE_URL,
  ),
  tributeSubscribeYearlyUrl: tributeProductUrl(
    tributeProductYearlyId,
    process.env.TRIBUTE_SUBSCRIBE_YEARLY_URL,
  ),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: env("GEMINI_MODEL", "gemini-3.1-flash-lite"),
  tmdbApiKey: process.env.TMDB_API_KEY ?? "",
  opensubtitlesApiKey: process.env.OPENSUBTITLES_API_KEY ?? "",
  opensubtitlesUsername: process.env.OPENSUBTITLES_USERNAME ?? "",
  opensubtitlesPassword: process.env.OPENSUBTITLES_PASSWORD ?? "",
  opensubtitlesUserAgent: process.env.OPENSUBTITLES_USER_AGENT ?? "EnglishWords v1.0",
  allowDevAuth: boolEnv("ALLOW_DEV_AUTH", true),
  devTelegramUserId: Number(process.env.DEV_TELEGRAM_USER_ID ?? 1),
  dictionaryDir,
  mediaDir: resolve(process.env.MEDIA_DIR ?? resolve(dictionaryDir, "../media")),
  migrationsDir: resolve(process.env.MIGRATIONS_DIR ?? resolve(here, "../../../migrations")),
  webDist: resolve(process.env.WEB_DIST ?? resolve(here, "../../web/dist")),
  petSufferHours: numEnv("PET_SUFFER_HOURS", 72),
  /** Telegram channel for Moti's posts (@name or -100…). Empty skips the post. */
  factChannelId: (process.env.FACT_CHANNEL_ID ?? "").trim(),
};

export function isPlaceholderBotToken(): boolean {
  return !config.botToken || config.botToken.includes("replace-me");
}
