import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPPORT_BUTTON = "Написать в поддержку";
export const SUPPORT_CANCEL = "Отмена";
export const SUPPORT_CALLBACK = "support";
export const DEFAULT_SUPPORT_USERNAME = "YOUR_SUPPORT_USERNAME";

export const SUPPORT_PROMPT =
  "Напишите сообщение в поддержку — текст, фото или файл. Перешлю команде, ответ придёт сюда.\n\nОтмена — /cancel.";

export const SUPPORT_RECEIVED = "Отправил команде. Ответ придёт в этот чат.";

export const SUPPORT_SELF =
  "Это и есть аккаунт поддержки. Сообщение принято — продублировал сюда как тикет.";

export const SUPPORT_UNAVAILABLE =
  "Сейчас не могу переслать сообщение. Попробуйте позже или напишите ещё раз через /support.";

export const SUPPORT_NO_NUMERIC_ID =
  "нет числового id поддержки: бот не может писать в личку по @username";

export const SUPPORT_REPLY_HINT =
  "Чтобы ответить пользователю, сделайте реплай на его сообщение или отправьте /reply <telegram_id> текст.";

const awaitingSupport = new Set<number>();
const ticketBySupportMessage = new Map<number, number>();
let learnedSupportUserId: number | null = null;

export function resetSupportState() {
  awaitingSupport.clear();
  ticketBySupportMessage.clear();
  learnedSupportUserId = null;
}

export function parseSupportUserId(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeUsername(raw: string | undefined, fallback = DEFAULT_SUPPORT_USERNAME): string {
  const value = (raw ?? fallback).trim().replace(/^@/, "");
  return value || fallback;
}

export function supportChatTarget(userId: number | null, username: string): number | string {
  if (userId) return userId;
  return username.startsWith("@") ? username : `@${username}`;
}

export function formatSupportHeader(user: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const username = user.username ? `@${user.username}` : "без username";
  return [
    `Поддержка от ${name || "пользователя"} (${username}, id ${user.id})`,
    "Ответьте реплаем на это сообщение или на пересланное. Запасной вариант: /reply " + user.id + " текст",
  ].join("\n");
}

export function parseReplyCommand(text: string | undefined): { userId: number; text: string } | null {
  if (!text) return null;
  const match = text.match(/^\/reply(?:@\w+)?\s+(\d+)\s+([\s\S]+)$/i);
  if (!match) return null;
  const userId = Number(match[1]);
  const body = match[2].trim();
  if (!Number.isFinite(userId) || userId <= 0 || !body) return null;
  return { userId, text: body };
}

export function isSupportStartPayload(payload: string | undefined): boolean {
  return payload?.trim().toLowerCase() === "support";
}

export function parseUserIdFromSupportHeader(text: string | undefined): number | null {
  if (!text) return null;
  const match = text.match(/\bid (\d+)\b/);
  return match ? Number(match[1]) : null;
}

export function userIdFromRepliedMessage(reply?: {
  message_id?: number;
  text?: string;
  caption?: string;
  forward_from?: { id: number };
  forward_origin?: { type: string; sender_user?: { id: number } };
} | null): number | null {
  if (!reply) return null;
  const mapped = reply.message_id != null ? ticketBySupportMessage.get(reply.message_id) : undefined;
  if (mapped) return mapped;
  const fromHeader =
    parseUserIdFromSupportHeader(reply.text) ?? parseUserIdFromSupportHeader(reply.caption);
  if (fromHeader) return fromHeader;
  if (reply.forward_from?.id) return reply.forward_from.id;
  if (reply.forward_origin?.type === "user" && reply.forward_origin.sender_user?.id) {
    return reply.forward_origin.sender_user.id;
  }
  return null;
}

export function rememberTicket(supportMessageId: number, userId: number) {
  ticketBySupportMessage.set(supportMessageId, userId);
}

export function enterSupportMode(userId: number) {
  awaitingSupport.add(userId);
}

export function leaveSupportMode(userId: number) {
  awaitingSupport.delete(userId);
}

export function isAwaitingSupport(userId: number): boolean {
  return awaitingSupport.has(userId);
}

export function configuredSupportUserId(): number | null {
  return parseSupportUserId(process.env.SUPPORT_TELEGRAM_USER_ID) ?? learnedSupportUserId;
}

export function matchesSupportUsername(username?: string | null): boolean {
  if (!username) return false;
  return username.toLowerCase() === normalizeUsername(process.env.SUPPORT_TELEGRAM_USERNAME).toLowerCase();
}

export function isSameSupportAccount(
  user: { id: number; username?: string } | null | undefined,
  target: number | string,
): boolean {
  if (!user) return false;
  if (typeof target === "number") return user.id === target;
  return matchesSupportUsername(user.username) && matchesSupportUsername(normalizeUsername(String(target)));
}

export function telegramErrorDescription(error: unknown): string {
  if (error && typeof error === "object" && "description" in error) {
    const description = (error as { description?: unknown }).description;
    if (typeof description === "string" && description.trim()) return description.trim();
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "";
}

export function supportUnavailableMessage(error?: unknown): string {
  const hint = telegramErrorDescription(error);
  if (!hint) return SUPPORT_UNAVAILABLE;
  return `${SUPPORT_UNAVAILABLE}\n(${hint})`;
}

function defaultEnvPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const path of [resolve(here, "../../../.env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
    if (existsSync(path)) return path;
  }
  return null;
}

function upsertSupportUserIdLine(text: string, id: number): string {
  if (/(?:^|\n)SUPPORT_TELEGRAM_USER_ID=\d+/.test(text)) {
    return text.replace(/(^|\n)SUPPORT_TELEGRAM_USER_ID=\d+/, `$1SUPPORT_TELEGRAM_USER_ID=${id}`);
  }
  if (/(?:^|\n)#?\s*SUPPORT_TELEGRAM_USER_ID=/.test(text)) {
    return text.replace(/(^|\n)#?\s*SUPPORT_TELEGRAM_USER_ID=.*/, `$1SUPPORT_TELEGRAM_USER_ID=${id}`);
  }
  if (text.includes("SUPPORT_TELEGRAM_USERNAME=")) {
    return text.replace(/(SUPPORT_TELEGRAM_USERNAME=.*\n?)/, `$1SUPPORT_TELEGRAM_USER_ID=${id}\n`);
  }
  return `${text.endsWith("\n") ? text : `${text}\n`}SUPPORT_TELEGRAM_USER_ID=${id}\n`;
}

export function persistSupportUserId(id: number, envPath?: string): boolean {
  process.env.SUPPORT_TELEGRAM_USER_ID = String(id);
  if (!envPath && (process.env.VITEST || process.env.NODE_ENV === "test")) return false;
  const path = envPath ?? defaultEnvPath();
  if (!path) return false;
  const current = readFileSync(path, "utf8");
  const next = upsertSupportUserIdLine(current, id);
  if (next === current) return true;
  writeFileSync(path, next);
  return true;
}

export function rememberSupportSender(user?: { id: number; username?: string } | null) {
  if (!user?.id || !matchesSupportUsername(user.username)) return;
  const known = parseSupportUserId(process.env.SUPPORT_TELEGRAM_USER_ID);
  if (known === user.id) {
    learnedSupportUserId = user.id;
    return;
  }
  if (known != null) return;
  learnedSupportUserId = user.id;
  persistSupportUserId(user.id);
  console.info(
    `support: learned id ${user.id} from @${user.username}. Set SUPPORT_TELEGRAM_USER_ID=${user.id}`,
  );
}

export function isConfiguredSupportUser(user?: { id: number; username?: string } | null): boolean {
  if (!user) return false;
  rememberSupportSender(user);
  const id = configuredSupportUserId();
  if (id != null) return user.id === id;
  return matchesSupportUsername(user.username);
}

export function hasDeliverableContent(message?: {
  text?: string;
  caption?: string;
  photo?: unknown;
  document?: unknown;
  video?: unknown;
  voice?: unknown;
  audio?: unknown;
  sticker?: unknown;
  video_note?: unknown;
} | null): boolean {
  if (!message) return false;
  return Boolean(
    message.photo ||
      message.document ||
      message.video ||
      message.voice ||
      message.audio ||
      message.sticker ||
      message.video_note ||
      (message.text && !message.text.startsWith("/")) ||
      message.caption,
  );
}

export async function resolveSupportChatId(
  getChat: (chatId: string) => Promise<{ id: number }>,
  from?: { id: number; username?: string } | null,
): Promise<number | null> {
  rememberSupportSender(from);
  const known = configuredSupportUserId();
  if (known) return known;
  if (from && matchesSupportUsername(from.username)) {
    persistSupportUserId(from.id);
    return from.id;
  }
  const username = normalizeUsername(process.env.SUPPORT_TELEGRAM_USERNAME);
  const chatId = `@${username}`;
  try {
    const chat = await getChat(chatId);
    learnedSupportUserId = chat.id;
    persistSupportUserId(chat.id);
    console.info(`support: resolved ${chatId} to ${chat.id}. Set SUPPORT_TELEGRAM_USER_ID=${chat.id}`);
    return chat.id;
  } catch (error) {
    console.error(
      `support: getChat(${chatId}) failed (${telegramErrorDescription(error) || "chat not found"}). ` +
        `Private users cannot be addressed by @username; need numeric SUPPORT_TELEGRAM_USER_ID.`,
      error,
    );
    return null;
  }
}
