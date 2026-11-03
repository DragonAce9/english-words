import { activeLanguage } from "./catalogContext.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { HttpError } from "./httpError.js";
import { languageInfo } from "./languages.js";
import type { AppUser } from "./types.js";

export const CATALOG_KINDS = ["movie", "series"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

const KIND_LABEL: Record<CatalogKind, string> = {
  movie: "фильм",
  series: "сериал",
};

export interface CatalogRequest {
  id: string;
  telegramUserId: number;
  kind: CatalogKind;
  title: string;
  comment: string;
  language: string;
}

/** Session id when the user has one. Browser dev with no id uses DEV_TELEGRAM_USER_ID. */
export function catalogRequesterId(telegramUserId: number): number {
  if (Number.isFinite(telegramUserId) && telegramUserId > 0) return telegramUserId;
  const fallback = config.devTelegramUserId;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 0;
}

export function formatCatalogRequestMessage(request: CatalogRequest): string {
  const lines = [
    "Заявка на добавление в каталог",
    `Тип: ${KIND_LABEL[request.kind]}`,
    `Название: ${request.title}`,
  ];
  if (request.comment) lines.push(`Комментарий: ${request.comment}`);
  lines.push(`Язык: ${languageInfo(request.language)?.title ?? request.language}`);
  if (request.telegramUserId > 0) lines.push(`Telegram id: ${request.telegramUserId}`);
  return lines.join("\n");
}

let notifyCatalogRequest: (text: string) => Promise<void> = async () => {};

export function setCatalogRequestNotifier(fn: ((text: string) => Promise<void>) | null): void {
  notifyCatalogRequest = fn ?? (async () => {});
}

function isKind(value: string): value is CatalogKind {
  return (CATALOG_KINDS as readonly string[]).includes(value);
}

export async function createCatalogRequest(
  user: AppUser,
  input: { kind?: string; title?: string; comment?: string },
): Promise<CatalogRequest> {
  const kind = String(input.kind ?? "").trim();
  const title = String(input.title ?? "").trim().slice(0, 200);
  const comment = String(input.comment ?? "").trim().slice(0, 300);
  if (!isKind(kind)) {
    throw new HttpError("Нужен тип: фильм или сериал", 400, "bad_request");
  }
  if (!title) {
    throw new HttpError("Нужно название", 400, "bad_request");
  }

  const telegramUserId = catalogRequesterId(user.telegramUserId);
  const language = user.language || activeLanguage();
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO catalog_requests (user_id, telegram_user_id, kind, title, comment, language)
    VALUES (
      ${user.id}::bigint,
      ${telegramUserId},
      ${kind},
      ${title},
      ${comment},
      ${language}
    )
    RETURNING id
  `;
  const request: CatalogRequest = {
    id: String(inserted[0]!.id),
    telegramUserId,
    kind,
    title,
    comment,
    language,
  };
  try {
    await notifyCatalogRequest(formatCatalogRequestMessage(request));
  } catch (error) {
    console.error("catalog request: support notify failed", error);
  }
  return request;
}
