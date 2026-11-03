import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InlineKeyboard } from "grammy";
import type { TransactionSql } from "postgres";
import { config } from "./config.js";
import { sql } from "./db.js";
import { HttpError } from "./httpError.js";
import { shuffle } from "./shuffle.js";
import { namedLanguages } from "./languages.js";
import { configuredSupportUserId, matchesSupportUsername, resolveSupportChatId } from "./support.js";
import type { AppUser, TeacherCard } from "./types.js";

const BIO_MAX = 200;
const NAME_MAX = 80;
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

interface TeacherRow {
  id: string;
  name: string;
  telegram_username: string;
  telegram_user_id: string | null;
  bio: string;
  photo_url: string | null;
  photo_file_id: string | null;
}

export interface TelegramTeacherProfile {
  telegramUserId: number | null;
  photoFileId: string | null;
  warning: string | null;
}

type TelegramLookup = (username: string) => Promise<TelegramTeacherProfile>;

let lookupOverride: TelegramLookup | null = null;

export function setTelegramTeacherLookup(lookup: TelegramLookup | null): void {
  lookupOverride = lookup;
}

export function isTeacherAdmin(user: Pick<AppUser, "telegramUserId" | "telegramUsername">): boolean {
  if (matchesSupportUsername(user.telegramUsername)) return true;
  const id = configuredSupportUserId();
  return id != null && user.telegramUserId === id;
}

function studiedLanguage(language: string | null | undefined): string {
  const value = language?.trim();
  return value || "en";
}

/** A profile for this user's learning language, matched by Telegram id or username. */
export async function isListedTeacher(
  user: Pick<AppUser, "telegramUserId" | "telegramUsername" | "language">,
): Promise<boolean> {
  const username = user.telegramUsername?.trim().replace(/^@/, "") ?? "";
  const language = studiedLanguage(user.language);
  const rows = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM teachers
    WHERE language = ${language}
      AND (
        telegram_user_id = ${user.telegramUserId}
        OR (${username} <> '' AND lower(telegram_username) = lower(${username}))
      )
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

function requireAdmin(user: AppUser): void {
  if (!isTeacherAdmin(user)) throw new HttpError("Только администратор может менять преподавателей", 403, "forbidden");
}

function toCard(row: TeacherRow): TeacherCard {
  const telegramUserId = row.telegram_user_id == null ? null : Number(row.telegram_user_id);
  return {
    id: row.id,
    name: row.name,
    telegramUsername: row.telegram_username,
    telegramUserId: Number.isFinite(telegramUserId) ? telegramUserId : null,
    bio: row.bio,
    photoUrl: row.photo_file_id ? `/teachers/${row.id}/photo` : row.photo_url,
  };
}

function normalizeTeacher(raw: Record<string, unknown>): TeacherCard | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const telegramUsername =
    typeof raw.telegramUsername === "string" ? raw.telegramUsername.trim().replace(/^@/, "") : "";
  if (!id || !name || !telegramUsername) return null;
  const bioRaw = typeof raw.bio === "string" ? raw.bio.trim() : "";
  const photoUrl = typeof raw.photoUrl === "string" && raw.photoUrl.trim() ? raw.photoUrl.trim() : null;
  const telegramUserId =
    typeof raw.telegramUserId === "number" && Number.isFinite(raw.telegramUserId) ? raw.telegramUserId : null;
  return { id, name, telegramUsername, telegramUserId, bio: bioRaw.slice(0, BIO_MAX), photoUrl };
}

async function readSeedFile(): Promise<TeacherCard[]> {
  try {
    const path = join(config.dictionaryDir, "..", "teachers.json");
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => (item && typeof item === "object" ? normalizeTeacher(item as Record<string, unknown>) : null))
      .filter((item): item is TeacherCard => Boolean(item));
  } catch {
    return [];
  }
}

async function seedTeachersFromFile(): Promise<void> {
  const counts = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM teachers`;
  if ((counts[0]?.n ?? 0) > 0) return;
  const seeded = await readSeedFile();
  for (const teacher of seeded) {
    await sql`
      INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, photo_url, language)
      VALUES (
        ${teacher.id},
        ${teacher.name},
        ${teacher.telegramUsername},
        ${teacher.telegramUserId},
        ${teacher.bio},
        ${teacher.photoUrl},
        'en'
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

export async function listTeachers(language: string): Promise<TeacherCard[]> {
  await seedTeachersFromFile();
  const studied = studiedLanguage(language);
  const rows = await sql<TeacherRow[]>`
    SELECT id, name, telegram_username, telegram_user_id::text, bio, photo_url, photo_file_id
    FROM teachers
    WHERE language = ${studied}
    ORDER BY created_at
  `;
  return rows.map(toCard);
}

/** Fresh random order on every call. */
export async function listTeachersShuffled(language: string): Promise<TeacherCard[]> {
  return shuffle(await listTeachers(language));
}

function missingPhotoWarning(): string {
  return `Фото из профиля Telegram не нашлось. Пусть преподаватель напишет /start боту @${config.botUsername}, затем нажми «Обновить фото».`;
}

interface TelegramChat {
  id?: number;
  photo?: { big_file_id?: string; small_file_id?: string };
}

interface TelegramPhotos {
  photos?: { file_id?: string }[][];
}

async function telegram<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  if (!config.botToken || config.botToken.includes("replace-me")) return null;
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
  if (!payload?.ok || payload.result == null) return null;
  return payload.result;
}

async function lookupTelegramTeacher(username: string): Promise<TelegramTeacherProfile> {
  if (lookupOverride) return lookupOverride(username);
  if (process.env.VITEST) return { telegramUserId: null, photoFileId: null, warning: null };
  const chat = await telegram<TelegramChat>("getChat", { chat_id: `@${username}` });
  const telegramUserId = typeof chat?.id === "number" ? chat.id : null;
  let photoFileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id || null;
  if (!photoFileId && telegramUserId != null) {
    const photos = await telegram<TelegramPhotos>("getUserProfilePhotos", { user_id: telegramUserId, limit: 1 });
    const sizes = photos?.photos?.[0] ?? [];
    photoFileId = sizes.at(-1)?.file_id || sizes[0]?.file_id || null;
  }
  if (!photoFileId) {
    return { telegramUserId, photoFileId: null, warning: missingPhotoWarning() };
  }
  return { telegramUserId, photoFileId, warning: null };
}

type AvatarLookup = (telegramUserId: number) => Promise<string | null>;

let avatarLookup: AvatarLookup | null = null;

export function setTeacherAvatarLookup(lookup: AvatarLookup | null): void {
  avatarLookup = lookup;
}

async function profilePhotoFileId(telegramUserId: number): Promise<string | null> {
  if (avatarLookup) return avatarLookup(telegramUserId);
  if (process.env.VITEST) return null;
  const photos = await telegram<TelegramPhotos>("getUserProfilePhotos", { user_id: telegramUserId, limit: 1 });
  const sizes = photos?.photos?.[0] ?? [];
  return sizes.at(-1)?.file_id || sizes[0]?.file_id || null;
}

const photoCache = new Map<string, { body: ArrayBuffer; type: string }>();

function imageType(filePath: string, header: string | null): string {
  if (header?.startsWith("image/")) return header;
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function readTeacherPhoto(id: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const rows = await sql<{ photo_file_id: string | null }[]>`
    SELECT photo_file_id FROM teachers WHERE id = ${id}
  `;
  const fileId = rows[0]?.photo_file_id;
  if (!fileId) return null;
  const cached = photoCache.get(fileId);
  if (cached) return cached;
  const file = await telegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file?.file_path || file.file_path.includes("..")) return null;
  const response = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const body = await response.arrayBuffer();
  const photo = { body, type: imageType(file.file_path, response.headers.get("content-type")) };
  if (photoCache.size > 50) photoCache.clear();
  photoCache.set(fileId, photo);
  return photo;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export async function createTeacher(
  user: AppUser,
  input: { name?: string; telegramUsername?: string; bio?: string },
): Promise<{ teacher: TeacherCard; warning: string | null }> {
  requireAdmin(user);
  const name = input.name?.trim() ?? "";
  const telegramUsername = input.telegramUsername?.trim().replace(/^@/, "") ?? "";
  const bio = (input.bio?.trim() ?? "").slice(0, BIO_MAX);
  if (!name || name.length > NAME_MAX) throw new HttpError("Нужно имя преподавателя", 400, "bad_request");
  if (!USERNAME.test(telegramUsername)) {
    throw new HttpError("Нужен Telegram username без ссылки, например anna_english", 400, "bad_request");
  }
  const profile = await lookupTelegramTeacher(telegramUsername);
  const language = studiedLanguage(user.language);
  const id = `${telegramUsername.toLowerCase()}-${randomBytes(3).toString("hex")}`;
  try {
    const rows = await sql<TeacherRow[]>`
      INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, photo_file_id, language)
      VALUES (
        ${id},
        ${name},
        ${telegramUsername},
        ${profile.telegramUserId},
        ${bio},
        ${profile.photoFileId},
        ${language}
      )
      RETURNING id, name, telegram_username, telegram_user_id::text, bio, photo_url, photo_file_id
    `;
    const row = rows[0];
    if (!row) throw new HttpError("Не удалось сохранить преподавателя", 500, "teacher_insert");
    return { teacher: toCard(row), warning: await listedWarning(profile.warning, profile.telegramUserId, [language]) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isUniqueViolation(error)) throw new HttpError("Такой Telegram уже есть в ленте", 409, "teacher_exists");
    throw error;
  }
}

export async function refreshTeacherPhoto(
  user: AppUser,
  id: string,
): Promise<{ teacher: TeacherCard; warning: string | null }> {
  requireAdmin(user);
  const trimmed = id.trim();
  const language = studiedLanguage(user.language);
  const existing = await sql<{ telegram_username: string; photo_file_id: string | null }[]>`
    SELECT telegram_username, photo_file_id FROM teachers
    WHERE id = ${trimmed} AND language = ${language}
  `;
  const username = existing[0]?.telegram_username;
  if (!username) throw new HttpError("Профиль уже удалён", 404, "not_found");
  const profile = await lookupTelegramTeacher(username);
  const previousFileId = existing[0]?.photo_file_id ?? null;
  if (profile.photoFileId && previousFileId && profile.photoFileId !== previousFileId) {
    photoCache.delete(previousFileId);
  }
  const rows = await sql<TeacherRow[]>`
    UPDATE teachers
    SET telegram_user_id = COALESCE(${profile.telegramUserId}::bigint, telegram_user_id),
        photo_file_id = COALESCE(${profile.photoFileId}::text, photo_file_id)
    WHERE id = ${trimmed} AND language = ${language}
    RETURNING id, name, telegram_username, telegram_user_id::text, bio, photo_url, photo_file_id
  `;
  const row = rows[0];
  if (!row) throw new HttpError("Профиль уже удалён", 404, "not_found");
  return { teacher: toCard(row), warning: profile.warning };
}

export async function deleteTeacher(user: AppUser, id: string): Promise<void> {
  requireAdmin(user);
  const trimmed = id.trim();
  if (!trimmed) throw new HttpError("Нужен профиль", 400, "bad_request");
  const language = studiedLanguage(user.language);
  const rows = await sql<{ id: string }[]>`
    DELETE FROM teachers WHERE id = ${trimmed} AND language = ${language} RETURNING id
  `;
  if (!rows[0]) throw new HttpError("Профиль уже удалён", 404, "not_found");
}

function teacherMatch(user: Pick<AppUser, "telegramUserId" | "telegramUsername">): { id: number; username: string } {
  return {
    id: user.telegramUserId,
    username: user.telegramUsername?.trim().replace(/^@/, "") ?? "",
  };
}

export async function hasTeacherProfile(user: Pick<AppUser, "telegramUserId" | "telegramUsername">): Promise<boolean> {
  const match = teacherMatch(user);
  const rows = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM teachers
    WHERE telegram_user_id = ${match.id}
       OR (${match.username} <> '' AND lower(telegram_username) = lower(${match.username}))
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

/** Removes this person's cards from every language feed. */
export async function leaveTeacherList(user: AppUser): Promise<void> {
  const match = teacherMatch(user);
  const rows = await sql<{ id: string }[]>`
    DELETE FROM teachers
    WHERE telegram_user_id = ${match.id}
       OR (${match.username} <> '' AND lower(telegram_username) = lower(${match.username}))
    RETURNING id
  `;
  if (rows.length === 0) throw new HttpError("Профиля в ленте нет", 404, "not_found");
}

export const TEACHER_APPLY_NOT_DELIVERED =
  "Не удалось отправить заявку в поддержку. Попробуйте ещё раз.";

export const TEACHER_REJECTION_MESSAGE =
  "Заявку в преподаватели не одобрили. Можно подать её ещё раз.";

function listedUserMessage(labels: string): string {
  return `Вас добавили в ленту преподавателей: ${labels}. Ученики с подпиской смогут написать вам в Telegram.`;
}

function labelForCode(code: string): string {
  const known = namedLanguages().find((item) => item.code === code);
  return known ? teachingLanguageLabel(code, known.title) : code;
}

async function tellTeacher(telegramUserId: number | null, text: string): Promise<boolean> {
  if (process.env.VITEST || telegramUserId == null) return false;
  const sent = await telegram<{ message_id?: number }>("sendMessage", { chat_id: telegramUserId, text });
  return sent != null;
}

async function listedWarning(
  warning: string | null,
  telegramUserId: number | null,
  languageCodes: string[],
): Promise<string | null> {
  if (process.env.VITEST) return warning;
  const told = await tellTeacher(telegramUserId, listedUserMessage(languageCodes.map(labelForCode).join(", ")));
  const note = told ? "Преподавателю написали в Telegram." : "Написать преподавателю не удалось.";
  return [warning, note].filter(Boolean).join(" ") || null;
}

const LANGUAGE_FLAGS: Record<string, string> = {
  en: "🇬🇧",
  fr: "🇫🇷",
  de: "🇩🇪",
  es: "🇪🇸",
  it: "🇮🇹",
  pt: "🇵🇹",
  fi: "🇫🇮",
  sl: "🇸🇮",
  hr: "🇭🇷",
  sr: "🇷🇸",
};

export interface TeacherApplication {
  name: string;
  telegramUsername: string;
  telegramUserId: number;
  bio: string;
  photoFileId: string | null;
  photoUrl: string | null;
  languages: { code: string; title: string }[];
}

function charCount(value: string): number {
  return [...value].length;
}

function teachingLanguageLabel(code: string, title: string): string {
  const flag = LANGUAGE_FLAGS[code] ?? "";
  return `${flag} ${title}`.trim();
}

/** Every application field. Photo is the account avatar, not an upload. */
export function formatTeacherApplication(application: TeacherApplication): string {
  const username = application.telegramUsername.replace(/^@/, "");
  const photo = application.photoFileId
    ? `photo_file_id ${application.photoFileId}`
    : application.photoUrl
      ? `photo_url ${application.photoUrl}`
      : "аватарки нет";
  return [
    "Заявка в преподаватели",
    `Имя: ${application.name}`,
    `Telegram: @${username}`,
    `Telegram id: ${application.telegramUserId}`,
    `О себе: ${application.bio}`,
    `Фото: ${photo}`,
    `Язык: ${application.languages.map((item) => teachingLanguageLabel(item.code, item.title)).join(", ")}`,
    "Одобрить — карточка в ленте, преподаватель получит сообщение. Отклонить — только сообщение.",
  ].join("\n");
}

async function listedLanguageCodes(
  user: Pick<AppUser, "telegramUserId" | "telegramUsername">,
): Promise<Set<string>> {
  const username = user.telegramUsername?.trim().replace(/^@/, "") ?? "";
  const rows = await sql<{ language: string }[]>`
    SELECT DISTINCT language FROM teachers
    WHERE telegram_user_id = ${user.telegramUserId}
       OR (${username} <> '' AND lower(telegram_username) = lower(${username}))
  `;
  return new Set(rows.map((row) => row.language));
}

export function namedTeachLanguages(): { code: string; title: string }[] {
  return namedLanguages().map(({ code, title }) => ({ code, title }));
}

/** Banner stays while any language from the welcome list is still open. */
export async function isListedForEveryTeachLanguage(
  user: Pick<AppUser, "telegramUserId" | "telegramUsername">,
): Promise<boolean> {
  const codes = namedLanguages().map((item) => item.code);
  const listed = await listedLanguageCodes(user);
  return codes.length > 0 && codes.every((code) => listed.has(code));
}

function selectedTeachingLanguages(input: unknown): { code: string; title: string }[] {
  if (!Array.isArray(input)) throw new HttpError("Выберите хотя бы один язык", 400, "bad_request");
  const known = new Map(namedLanguages().map((item) => [item.code, item.title]));
  const chosen: { code: string; title: string }[] = [];
  for (const item of input) {
    if (typeof item !== "string") throw new HttpError("Выберите язык из списка", 400, "bad_request");
    const code = item.trim().toLowerCase();
    const title = known.get(code);
    if (!title) throw new HttpError("Выберите язык из списка", 400, "bad_request");
    if (!chosen.some((language) => language.code === code)) chosen.push({ code, title });
  }
  if (chosen.length === 0) throw new HttpError("Выберите хотя бы один язык", 400, "bad_request");
  return chosen;
}

export interface TeacherApplicationNotice {
  id: string;
  text: string;
}

export interface TeacherDecision {
  summary: string;
  telegramUserId: number;
  userMessage: string | null;
}

let notifyTeacherApplication: (notice: TeacherApplicationNotice) => Promise<void> = async () => {
  throw new Error("teacher application notifier is not configured");
};

export function setTeacherApplicationNotifier(fn: ((notice: TeacherApplicationNotice) => Promise<void>) | null): void {
  notifyTeacherApplication =
    fn ??
    (async () => {
      throw new Error("teacher application notifier is not configured");
    });
}

export async function deliverTeacherApplication(
  notice: TeacherApplicationNotice,
  api: {
    getChat: (chatId: string) => Promise<{ id: number }>;
    sendMessage: (chatId: number, text: string, extra?: object) => Promise<unknown>;
  },
): Promise<void> {
  const target = await resolveSupportChatId((chatId) => api.getChat(chatId));
  if (target == null) {
    console.error("teacher application: no support chat");
    throw new Error("no support chat");
  }
  const keyboard = new InlineKeyboard()
    .text("Одобрить", `teacher:ok:${notice.id}`)
    .text("Отклонить", `teacher:no:${notice.id}`);
  await api.sendMessage(target, notice.text, { reply_markup: keyboard });
}

export async function submitTeacherApplication(
  user: AppUser,
  input: { name?: string; bio?: string; languages?: unknown },
): Promise<{ ok: true }> {
  if (await isListedForEveryTeachLanguage(user)) {
    throw new HttpError("Вы уже в ленте всех этих языков", 409, "already_listed");
  }
  const name = input.name?.trim() ?? "";
  const bio = input.bio?.trim() ?? "";
  const telegramUsername = user.telegramUsername?.trim().replace(/^@/, "") ?? "";
  if (!name || name.length > NAME_MAX) throw new HttpError("Нужно имя", 400, "bad_request");
  if (!bio) throw new HttpError("Нужно коротко о себе", 400, "bad_request");
  if (charCount(bio) > BIO_MAX) throw new HttpError("О себе — не больше 200 символов", 400, "bad_request");
  if (!USERNAME.test(telegramUsername)) {
    throw new HttpError("В аккаунте Telegram нет username. Он нужен для карточки.", 400, "bad_request");
  }
  const languages = selectedTeachingLanguages(input.languages);
  const photoUrl = user.photoUrl?.trim() || null;
  const photoFileId = photoUrl ? null : await profilePhotoFileId(user.telegramUserId);
  const text = formatTeacherApplication({
    name,
    telegramUsername,
    telegramUserId: user.telegramUserId,
    bio,
    photoFileId,
    photoUrl,
    languages,
  });
  const saved = await sql<{ id: string }[]>`
    INSERT INTO teacher_applications (
      telegram_user_id, telegram_username, name, bio, photo_file_id, photo_url, languages
    )
    VALUES (
      ${user.telegramUserId},
      ${telegramUsername},
      ${name},
      ${bio},
      ${photoFileId},
      ${photoUrl},
      ${languages.map((item) => item.code)}::text[]
    )
    RETURNING id::text
  `;
  const id = saved[0]?.id;
  if (!id) throw new HttpError(TEACHER_APPLY_NOT_DELIVERED, 500, "teacher_apply");
  try {
    await notifyTeacherApplication({ id, text });
  } catch (error) {
    await sql`DELETE FROM teacher_applications WHERE id = ${id}::bigint`;
    console.error("teacher application: support notify failed", error);
    throw new HttpError(TEACHER_APPLY_NOT_DELIVERED, 502, "support_unreachable");
  }
  return { ok: true };
}

function lineValue(text: string, label: string): string | null {
  const match = text.match(new RegExp(`^${label}:\\s*(.*)$`, "m"));
  const value = match?.[1]?.trim() ?? "";
  return value || null;
}

/** Reads the support message, including ones sent before the approve buttons existed. */
export function parseTeacherApplicationMessage(text: string): TeacherApplication | null {
  if (!text.startsWith("Заявка в преподаватели")) return null;
  const name = lineValue(text, "Имя");
  const usernameRaw = lineValue(text, "Telegram");
  const idRaw = lineValue(text, "Telegram id");
  const bio = lineValue(text, "О себе");
  const photo = lineValue(text, "Фото");
  const languageLine = lineValue(text, "Язык");
  if (!name || !usernameRaw || !idRaw || !bio || !photo || !languageLine) return null;
  const telegramUsername = usernameRaw.replace(/^@/, "");
  const telegramUserId = Number(idRaw);
  if (!USERNAME.test(telegramUsername) || !Number.isInteger(telegramUserId)) return null;
  const languages = namedLanguages()
    .filter((item) => languageLine.includes(item.title))
    .map(({ code, title }) => ({ code, title }));
  if (languages.length === 0) return null;
  let photoFileId: string | null = null;
  let photoUrl: string | null = null;
  if (photo.startsWith("photo_file_id ")) photoFileId = photo.slice("photo_file_id ".length).trim() || null;
  else if (photo.startsWith("photo_url ")) photoUrl = photo.slice("photo_url ".length).trim() || null;
  return { name, telegramUsername, telegramUserId, bio, photoFileId, photoUrl, languages };
}

async function insertTeacherCards(
  db: typeof sql | TransactionSql,
  application: TeacherApplication,
): Promise<{ added: string[]; existed: string[] }> {
  const added: string[] = [];
  const existed: string[] = [];
  for (const language of application.languages) {
    const id = `${application.telegramUsername.toLowerCase()}-${language.code}-${randomBytes(3).toString("hex")}`;
    try {
      await db`
        INSERT INTO teachers (id, name, telegram_username, telegram_user_id, bio, photo_url, photo_file_id, language)
        VALUES (
          ${id},
          ${application.name},
          ${application.telegramUsername},
          ${application.telegramUserId},
          ${application.bio},
          ${application.photoUrl},
          ${application.photoFileId},
          ${language.code}
        )
      `;
      added.push(language.code);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      existed.push(language.code);
    }
  }
  return { added, existed };
}

function decisionFor(application: TeacherApplication, added: string[], existed: string[]): TeacherDecision {
  const labels = (codes: string[]) =>
    application.languages
      .filter((item) => codes.includes(item.code))
      .map((item) => teachingLanguageLabel(item.code, item.title))
      .join(", ");
  const listed = application.languages.map((item) => teachingLanguageLabel(item.code, item.title)).join(", ");
  let summary = `Одобрено: ${labels(added)}.`;
  if (added.length === 0) summary = `Уже в ленте: ${labels(existed) || listed}. Повторно не писал.`;
  else if (existed.length > 0) summary = `Одобрено. Добавлены: ${labels(added)}. Уже были: ${labels(existed)}.`;
  return {
    summary,
    telegramUserId: application.telegramUserId,
    userMessage: added.length === 0 ? null : listedUserMessage(listed),
  };
}

interface StoredApplication {
  id: string;
  telegram_user_id: string;
  telegram_username: string;
  name: string;
  bio: string;
  photo_file_id: string | null;
  photo_url: string | null;
  languages: string[];
  status: string;
}

function storedApplication(row: StoredApplication): TeacherApplication {
  const known = new Map(namedLanguages().map((item) => [item.code, item.title]));
  return {
    name: row.name,
    telegramUsername: row.telegram_username,
    telegramUserId: Number(row.telegram_user_id),
    bio: row.bio,
    photoFileId: row.photo_file_id,
    photoUrl: row.photo_url,
    languages: row.languages.map((code) => ({ code, title: known.get(code) ?? code })),
  };
}

async function pendingApplication(tx: TransactionSql, id: string): Promise<StoredApplication> {
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) throw new HttpError("Заявка не найдена", 404, "not_found");
  const rows = await tx<StoredApplication[]>`
    SELECT id::text, telegram_user_id::text, telegram_username, name, bio,
           photo_file_id, photo_url, languages, status
    FROM teacher_applications
    WHERE id = ${trimmed}::bigint
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new HttpError("Заявка не найдена", 404, "not_found");
  if (row.status !== "pending") throw new HttpError("Заявка уже разобрана", 409, "already_decided");
  return row;
}

/** Puts the applicant into the feed for every language in the message. */
export async function acceptTeacherApplication(application: TeacherApplication): Promise<TeacherDecision> {
  const { added, existed } = await insertTeacherCards(sql, application);
  return decisionFor(application, added, existed);
}

export async function approveTeacherApplication(id: string): Promise<TeacherDecision> {
  return sql.begin(async (tx) => {
    const row = await pendingApplication(tx, id);
    const application = storedApplication(row);
    const { added, existed } = await insertTeacherCards(tx, application);
    await tx`
      UPDATE teacher_applications
      SET status = 'approved', decided_at = now()
      WHERE id = ${row.id}::bigint
    `;
    return decisionFor(application, added, existed);
  });
}

export async function rejectTeacherApplication(id: string): Promise<TeacherDecision> {
  return sql.begin(async (tx) => {
    const row = await pendingApplication(tx, id);
    await tx`
      UPDATE teacher_applications
      SET status = 'rejected', decided_at = now()
      WHERE id = ${row.id}::bigint
    `;
    return {
      summary: "Отклонено.",
      telegramUserId: Number(row.telegram_user_id),
      userMessage: TEACHER_REJECTION_MESSAGE,
    };
  });
}
