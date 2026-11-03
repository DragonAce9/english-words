import { InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { sql } from "./db.js";
import { dictionary } from "./dictionary.js";
import { HttpError } from "./httpError.js";
import { resolveSupportChatId } from "./support.js";
import type { AppUser } from "./types.js";

export const REPORT_REASONS = ["translation", "category", "sense", "example"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const REASON_LABEL: Record<ReportReason, string> = {
  translation: "Неверный перевод",
  category: "Не та категория",
  sense: "Не то значение",
  example: "Плохой пример",
};

export interface WordReport {
  id: string;
  telegramUserId: number;
  wordId: string;
  en: string;
  ru: string[];
  themeId: string;
  themeTitle: string;
  example: string;
  reason: ReportReason;
  comment: string;
}

export interface WordVerdict {
  apply: boolean;
  ru: string[];
  themeId: string;
  note: string;
}

export interface ReportDecision {
  status: "rejected" | "applied" | "skipped" | "failed";
  summary: string;
}

type Reviewer = (report: WordReport) => Promise<WordVerdict>;

interface ReportRow {
  id: string;
  telegram_user_id: string;
  word_id: string;
  en: string;
  ru: string[];
  theme_id: string;
  theme_title: string;
  example: string;
  reason: ReportReason;
  comment: string;
  status: string;
}

function isReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

function rowToReport(row: ReportRow): WordReport {
  return {
    id: String(row.id),
    telegramUserId: Number(row.telegram_user_id),
    wordId: row.word_id,
    en: row.en,
    ru: row.ru,
    themeId: row.theme_id,
    themeTitle: row.theme_title,
    example: row.example,
    reason: row.reason,
    comment: row.comment,
  };
}

export const REPORT_NOT_DELIVERED =
  "Не удалось отправить жалобу в поддержку. Попробуйте ещё раз.";

export function formatReportNotice(report: WordReport): string {
  const lines = [
    "Жалоба на карточку",
    `${report.en} — ${report.ru.join(" / ")}`,
    `id: ${report.wordId}`,
    `Тема: ${report.themeTitle} (${report.themeId})`,
    `Причина: ${REASON_LABEL[report.reason]}`,
  ];
  if (report.example) lines.push(`Пример: ${report.example}`);
  if (report.comment) lines.push(`Комментарий: ${report.comment}`);
  lines.push(`Пользователь: ${report.telegramUserId}`);
  lines.push("Апрув запускает проверку ИИ. Отклонить — ИИ не вызывается.");
  return lines.join("\n");
}

let notifyReport: (report: WordReport) => Promise<void> = async () => {};

export function setReportNotifier(fn: ((report: WordReport) => Promise<void>) | null): void {
  notifyReport = fn ?? (async () => {});
}

export async function deliverReportToSupport(
  report: WordReport,
  api: {
    getChat: (chatId: string) => Promise<{ id: number }>;
    sendMessage: (chatId: number, text: string, extra?: object) => Promise<unknown>;
  },
): Promise<void> {
  const target = await resolveSupportChatId((chatId) => api.getChat(chatId));
  if (target == null) {
    console.error("report: no support chat");
    throw new Error("no support chat");
  }
  const keyboard = new InlineKeyboard()
    .text("Апрув", `report:ok:${report.id}`)
    .text("Отклонить", `report:no:${report.id}`);
  await api.sendMessage(target, formatReportNotice(report), { reply_markup: keyboard });
}

async function publishReport(report: WordReport): Promise<void> {
  try {
    await notifyReport(report);
  } catch (error) {
    console.error("report: support notify failed", error);
    throw new HttpError(REPORT_NOT_DELIVERED, 502, "support_unreachable");
  }
  await sql`UPDATE word_reports SET notified_at = now() WHERE id = ${report.id}::bigint`;
}

const REVIEW_SYSTEM =
  "You check one vocabulary card after a learner complaint. Return JSON only. " +
  "Fields: {\"apply\": boolean, \"ru\": [Russian glosses, max 3], \"themeId\": catalog theme id or \"\", \"note\": short Russian note}. " +
  "apply is true only when the complaint is right. " +
  "ru is the corrected gloss list when the translation or the sense is wrong, otherwise []. " +
  "themeId is the correct catalog theme when the category is wrong, otherwise \"\". " +
  "Do not invent a new English word. Keep a correct card unchanged.";

function glosses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item ?? "").trim())
    .filter((item) => item && /[а-яё]/i.test(item))
    .slice(0, 3);
}

async function geminiReview(report: WordReport): Promise<WordVerdict> {
  if (!config.geminiApiKey) {
    return { apply: false, ru: [], themeId: "", note: "Проверка ИИ недоступна: нет ключа." };
  }
  const themes = dictionary
    .listThemes()
    .filter((theme) => !dictionary.isMediaPack(theme) && theme.kind !== "text")
    .map((theme) => ({ id: theme.id, title: theme.title }));
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: REVIEW_SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify({
                complaint: REASON_LABEL[report.reason],
                comment: report.comment,
                card: {
                  id: report.wordId,
                  en: report.en,
                  ru: report.ru,
                  themeId: report.themeId,
                  themeTitle: report.themeTitle,
                  example: report.example,
                },
                themes,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            apply: { type: "BOOLEAN" },
            ru: { type: "ARRAY", items: { type: "STRING" } },
            themeId: { type: "STRING" },
            note: { type: "STRING" },
          },
          required: ["apply", "ru", "themeId", "note"],
        },
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI report review failed HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
  const parsed = JSON.parse(content) as { apply?: boolean; ru?: unknown; themeId?: unknown; note?: unknown };
  return {
    apply: Boolean(parsed.apply),
    ru: glosses(parsed.ru),
    themeId: String(parsed.themeId ?? "").trim(),
    note: String(parsed.note ?? "").trim().slice(0, 400),
  };
}

let reviewWord: Reviewer = geminiReview;

export function setWordReviewer(fn: Reviewer | null): void {
  reviewWord = fn ?? geminiReview;
}

export async function createWordReport(
  user: AppUser,
  input: { wordId?: string; themeId?: string; reason?: string; comment?: string },
): Promise<WordReport> {
  const wordId = String(input.wordId ?? "").trim();
  const themeId = String(input.themeId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const comment = String(input.comment ?? "").trim().slice(0, 300);
  if (!wordId || !themeId || !isReason(reason)) {
    throw new HttpError("Нужны слово, тема и причина", 400, "bad_request");
  }
  const word = dictionary.getWord(wordId);
  const theme = dictionary.getTheme(themeId);
  if (!word || !theme || !theme.words.some((item) => item.id === word.id)) {
    throw new HttpError("Такой карточки нет", 404, "not_found");
  }
  const listing = theme.words.find((item) => item.id === word.id) ?? word;
  const existing = await sql<(ReportRow & { notified_at: Date | null })[]>`
    SELECT id, telegram_user_id, word_id, en, ru, theme_id, theme_title, example, reason, comment, status, notified_at
    FROM word_reports
    WHERE user_id = ${user.id}::bigint AND word_id = ${word.id} AND theme_id = ${theme.id} AND status = 'pending'
    ORDER BY id DESC
    LIMIT 1
  `;
  if (existing[0]?.notified_at) return rowToReport(existing[0]);
  if (existing[0]) {
    const report = rowToReport(existing[0]);
    await publishReport(report);
    return report;
  }

  const inserted = await sql<ReportRow[]>`
    INSERT INTO word_reports (
      user_id, telegram_user_id, word_id, en, ru, theme_id, theme_title, example, reason, comment
    )
    VALUES (
      ${user.id}::bigint,
      ${user.telegramUserId},
      ${word.id},
      ${listing.en},
      ${listing.ru},
      ${theme.id},
      ${theme.title},
      ${listing.example ?? ""},
      ${reason},
      ${comment}
    )
    RETURNING id, telegram_user_id, word_id, en, ru, theme_id, theme_title, example, reason, comment, status
  `;
  const report = rowToReport(inserted[0]!);
  await publishReport(report);
  return report;
}

async function saveFix(report: WordReport, ru: string[] | null, toThemeId: string | null, note: string): Promise<void> {
  await sql`
    INSERT INTO word_fixes (word_id, ru, from_theme_id, to_theme_id, note, updated_at)
    VALUES (
      ${report.wordId},
      ${ru},
      ${report.themeId},
      ${toThemeId},
      ${note},
      now()
    )
    ON CONFLICT (word_id) DO UPDATE SET
      ru = COALESCE(EXCLUDED.ru, word_fixes.ru),
      from_theme_id = EXCLUDED.from_theme_id,
      to_theme_id = COALESCE(EXCLUDED.to_theme_id, word_fixes.to_theme_id),
      note = EXCLUDED.note,
      updated_at = now()
  `;
}

function applyVerdict(report: WordReport, verdict: WordVerdict): { changed: boolean; note: string; ru: string[] | null; toThemeId: string | null } {
  const parts: string[] = [];
  let ru: string[] | null = null;
  let toThemeId: string | null = null;
  const sameGloss = verdict.ru.length === 0 || verdict.ru.join("\n") === report.ru.join("\n");
  if (!sameGloss && dictionary.setGloss(report.wordId, verdict.ru)) {
    ru = verdict.ru;
    parts.push(`перевод: ${verdict.ru.join(" / ")}`);
  }
  const nextTheme = verdict.themeId && verdict.themeId !== report.themeId ? verdict.themeId : "";
  if (nextTheme && dictionary.moveListing(report.wordId, report.themeId, nextTheme)) {
    toThemeId = nextTheme;
    const title = dictionary.getTheme(nextTheme)?.title ?? nextTheme;
    parts.push(`категория: ${title}`);
  }
  const note = [verdict.note, ...parts].filter(Boolean).join(". ");
  return { changed: ru != null || toThemeId != null, note, ru, toThemeId };
}

export async function approveWordReport(id: string): Promise<ReportDecision> {
  const claimed = await sql<ReportRow[]>`
    UPDATE word_reports
    SET status = 'processing', decided_at = now()
    WHERE id = ${id}::bigint AND status = 'pending'
    RETURNING id, telegram_user_id, word_id, en, ru, theme_id, theme_title, example, reason, comment, status
  `;
  const row = claimed[0];
  if (!row) throw new HttpError("Жалоба уже разобрана", 409, "report_closed");
  const report = rowToReport(row);
  try {
    const verdict = await reviewWord(report);
    if (!verdict.apply) {
      const note = verdict.note || "ИИ оставил карточку как есть.";
      await sql`UPDATE word_reports SET status = 'skipped', ai_note = ${note} WHERE id = ${id}::bigint`;
      return { status: "skipped", summary: note };
    }
    const applied = applyVerdict(report, verdict);
    if (!applied.changed) {
      const note = applied.note || "ИИ не нашёл, что менять.";
      await sql`UPDATE word_reports SET status = 'skipped', ai_note = ${note} WHERE id = ${id}::bigint`;
      return { status: "skipped", summary: note };
    }
    await saveFix(report, applied.ru, applied.toThemeId, applied.note);
    await sql`UPDATE word_reports SET status = 'applied', ai_note = ${applied.note} WHERE id = ${id}::bigint`;
    return { status: "applied", summary: applied.note };
  } catch (error) {
    const note = error instanceof Error ? error.message : "Проверка не удалась";
    await sql`UPDATE word_reports SET status = 'failed', ai_note = ${note.slice(0, 400)} WHERE id = ${id}::bigint`;
    return { status: "failed", summary: note };
  }
}

export async function rejectWordReport(id: string): Promise<ReportDecision> {
  const updated = await sql<{ id: string }[]>`
    UPDATE word_reports
    SET status = 'rejected', decided_at = now(), ai_note = 'Отклонено поддержкой'
    WHERE id = ${id}::bigint AND status = 'pending'
    RETURNING id
  `;
  if (!updated[0]) throw new HttpError("Жалоба уже разобрана", 409, "report_closed");
  return { status: "rejected", summary: "Отклонено. ИИ не вызывался." };
}

export async function applyStoredFixes(): Promise<number> {
  const rows = await sql<{ word_id: string; ru: string[] | null; from_theme_id: string | null; to_theme_id: string | null }[]>`
    SELECT word_id, ru, from_theme_id, to_theme_id FROM word_fixes
  `;
  let applied = 0;
  for (const row of rows) {
    if (row.ru && row.ru.length > 0) dictionary.setGloss(row.word_id, row.ru);
    if (row.to_theme_id && row.from_theme_id && row.to_theme_id !== row.from_theme_id) {
      dictionary.moveListing(row.word_id, row.from_theme_id, row.to_theme_id);
    }
    applied += 1;
  }
  if (applied > 0) console.info(`reports: restored ${applied} word fixes`);
  return applied;
}
