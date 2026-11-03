import { Bot, InlineKeyboard } from "grammy";
import { config, isPlaceholderBotToken } from "./config.js";
import { approveWordReport, rejectWordReport } from "./reports.js";
import {
  acceptTeacherApplication,
  approveTeacherApplication,
  parseTeacherApplicationMessage,
  rejectTeacherApplication,
  TEACHER_REJECTION_MESSAGE,
  type TeacherDecision,
} from "./teachers.js";
import {
  SUPPORT_BUTTON,
  SUPPORT_CALLBACK,
  SUPPORT_CANCEL,
  SUPPORT_PROMPT,
  SUPPORT_NO_NUMERIC_ID,
  SUPPORT_RECEIVED,
  SUPPORT_REPLY_HINT,
  SUPPORT_SELF,
  enterSupportMode,
  formatSupportHeader,
  hasDeliverableContent,
  isAwaitingSupport,
  isConfiguredSupportUser,
  isSameSupportAccount,
  isSupportStartPayload,
  leaveSupportMode,
  parseReplyCommand,
  rememberSupportSender,
  rememberTicket,
  resolveSupportChatId,
  supportUnavailableMessage,
  telegramErrorDescription,
  userIdFromRepliedMessage,
} from "./support.js";
import { registerFromStart } from "./referrals.js";

const START_TEXT = `Привет! 👋 Я Моти, твой помощник в тренировке словарного запаса. 🧠✨

Я знаю много языков:
🇬🇧 Английский
🇫🇷 Французский
🇩🇪 Немецкий
🇪🇸 Испанский
🇮🇹 Итальянский
🇵🇹 Португальский
🇫🇮 Финский
🇸🇮 Словенский
🇭🇷 Хорватский
🇷🇸 Сербский
🚀 Скоро будут и другие!

📚 В каждом языке ты можешь учиться по тематическим подборкам, фильмам 🎬 и сериалам 🍿, или просто добавить свой текст и изучать слова из него.

🔬 Я узнал, как правильно учить слова, и сделал упражнения в соответствии с научными исследованиями в работе памяти и изучении иностранных языков. 💡

❤️ Я забочусь о темах, подборках и леммах слов в каждом языке и очень хочу, чтобы это приложение помогло тебе!

🌟 Присоединяйся ко мне и давай изучать слова вместе! 🚀`;

/** Telegram Web App buttons require a public HTTPS URL. localhost http makes sendMessage 400. */
export function isHttpsWebAppUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function mainKeyboard() {
  const keyboard = new InlineKeyboard();
  if (isHttpsWebAppUrl(config.webappUrl)) {
    keyboard.webApp("Открыть приложение", config.webappUrl).row();
  }
  return keyboard.text(SUPPORT_BUTTON, SUPPORT_CALLBACK);
}

async function replyWithKeyboard(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  text: string,
) {
  try {
    await ctx.reply(text, { reply_markup: mainKeyboard() });
  } catch (error) {
    console.error("bot: reply with keyboard failed, sending text only", error);
    await ctx.reply(text);
  }
}

async function promptSupport(ctx: { from?: { id: number } | null; reply: (text: string, extra?: object) => Promise<unknown> }) {
  if (!ctx.from) return;
  enterSupportMode(ctx.from.id);
  await replyWithKeyboard(ctx, SUPPORT_PROMPT);
}

async function deliverUserMessage(ctx: {
  from?: { id: number; username?: string; first_name?: string; last_name?: string } | null;
  message?: { message_id: number } | undefined;
  api: {
    getChat: (chatId: string) => Promise<{ id: number }>;
    sendMessage: (chatId: number | string, text: string) => Promise<{ message_id: number }>;
  };
  forwardMessage: (chatId: number | string) => Promise<{ message_id: number }>;
  copyMessage: (chatId: number | string) => Promise<{ message_id: number }>;
  reply: (text: string) => Promise<unknown>;
}) {
  const user = ctx.from;
  if (!user || !ctx.message) return;
  rememberSupportSender(user);
  const target = await resolveSupportChatId((chatId) => ctx.api.getChat(chatId), user);
  if (target == null) {
    console.error("support: cannot deliver, no numeric destination.", SUPPORT_NO_NUMERIC_ID);
    await ctx.reply(supportUnavailableMessage(new Error(SUPPORT_NO_NUMERIC_ID)));
    return;
  }
  try {
    const header = await ctx.api.sendMessage(target, formatSupportHeader(user));
    rememberTicket(header.message_id, user.id);
    try {
      const forwarded = await ctx.forwardMessage(target);
      rememberTicket(forwarded.message_id, user.id);
    } catch (error) {
      console.error("support: forward failed, copying", telegramErrorDescription(error), error);
      const copied = await ctx.copyMessage(target);
      rememberTicket(copied.message_id, user.id);
    }
    leaveSupportMode(user.id);
    await ctx.reply(isSameSupportAccount(user, target) ? SUPPORT_SELF : SUPPORT_RECEIVED);
  } catch (error) {
    console.error("support: cannot deliver to", target, telegramErrorDescription(error), error);
    await ctx.reply(supportUnavailableMessage(error));
  }
}

async function deliverSupportReply(
  ctx: {
    copyMessage: (chatId: number | string) => Promise<unknown>;
    api: { sendMessage: (chatId: number | string, text: string) => Promise<unknown> };
    message?: { text?: string; photo?: unknown; document?: unknown; caption?: string };
    reply: (text: string) => Promise<unknown>;
  },
  userId: number,
  text?: string,
) {
  try {
    if (text) {
      await ctx.api.sendMessage(userId, text);
    } else {
      await ctx.copyMessage(userId);
    }
    await ctx.reply("Отправил пользователю.");
  } catch (error) {
    console.error("support: cannot copy reply to", userId, error);
    await ctx.reply("Не удалось отправить. Пользователь мог заблокировать бота.");
  }
}

async function notifyApplicant(
  ctx: { api: { sendMessage: (chatId: number, text: string) => Promise<unknown> } },
  telegramUserId: number,
  text: string,
): Promise<boolean> {
  try {
    await ctx.api.sendMessage(telegramUserId, text);
    return true;
  } catch (error) {
    console.error("teacher application: applicant notify failed", error);
    return false;
  }
}

async function finishTeacherDecision(
  ctx: {
    api: { sendMessage: (chatId: number, text: string) => Promise<unknown> };
    editMessageText: (text: string, extra?: object) => Promise<unknown>;
  },
  previous: string,
  decision: TeacherDecision,
): Promise<void> {
  const told = decision.userMessage
    ? (await notifyApplicant(ctx, decision.telegramUserId, decision.userMessage))
      ? "Преподавателю написали."
      : "Написать преподавателю не удалось — пусть откроет бота."
    : "";
  await ctx.editMessageText([previous, decision.summary, told].filter(Boolean).join("\n\n"), {
    reply_markup: { inline_keyboard: [] },
  });
}

export function createBot(): Bot | null {
  if (isPlaceholderBotToken()) {
    console.info("bot skipped: BOT_TOKEN is a placeholder");
    return null;
  }

  const bot = new Bot(config.botToken);

  bot.use(async (ctx, next) => {
    rememberSupportSender(ctx.from);
    await next();
  });

  bot.command("start", async (ctx) => {
    if (ctx.from) {
      try {
        await registerFromStart(ctx.from.id, ctx.match);
      } catch (error) {
        console.error("bot: start signup failed", error);
      }
    }
    if (isSupportStartPayload(ctx.match)) {
      await promptSupport(ctx);
      return;
    }
    if (ctx.from) leaveSupportMode(ctx.from.id);
    await replyWithKeyboard(ctx, START_TEXT);
  });

  bot.command("support", async (ctx) => {
    await promptSupport(ctx);
  });

  bot.command("cancel", async (ctx) => {
    if (ctx.from) leaveSupportMode(ctx.from.id);
    await replyWithKeyboard(ctx, "Ок, не жду сообщение в поддержку.");
  });

  bot.command("reply", async (ctx) => {
    if (!isConfiguredSupportUser(ctx.from)) {
      await ctx.reply("Эта команда только для поддержки.");
      return;
    }
    const parsed = parseReplyCommand(ctx.message?.text);
    if (!parsed) {
      await ctx.reply("Формат: /reply <telegram_id> текст");
      return;
    }
    await deliverSupportReply(ctx, parsed.userId, parsed.text);
  });

  bot.callbackQuery(SUPPORT_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptSupport(ctx);
  });

  bot.callbackQuery(/^teacher:(ok|no):(\d+)$/, async (ctx) => {
    if (!isConfiguredSupportUser(ctx.from)) {
      await ctx.answerCallbackQuery({ text: "Только для поддержки", show_alert: true });
      return;
    }
    const approve = ctx.match[1] === "ok";
    const applicationId = ctx.match[2] ?? "";
    await ctx.answerCallbackQuery(approve ? { text: "Одобряю" } : { text: "Отклоняю" });
    try {
      const decision = approve
        ? await approveTeacherApplication(applicationId)
        : await rejectTeacherApplication(applicationId);
      const previous =
        ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text ?? "" : "";
      await finishTeacherDecision(ctx, previous, decision);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Не удалось разобрать заявку");
    }
  });

  bot.callbackQuery(/^report:(ok|no):(\d+)$/, async (ctx) => {
    if (!isConfiguredSupportUser(ctx.from)) {
      await ctx.answerCallbackQuery({ text: "Только для поддержки", show_alert: true });
      return;
    }
    const approve = ctx.match[1] === "ok";
    const reportId = ctx.match[2] ?? "";
    await ctx.answerCallbackQuery(approve ? { text: "Запускаю проверку" } : undefined);
    try {
      const result = approve ? await approveWordReport(reportId) : await rejectWordReport(reportId);
      const previous = ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : "";
      await ctx.editMessageText(`${previous}\n\n${result.summary}`.trim());
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Не удалось разобрать жалобу");
    }
  });

  bot.on("message", async (ctx, next) => {
    const text = ctx.message.text?.trim();
    if (text === SUPPORT_BUTTON) {
      await promptSupport(ctx);
      return;
    }
    if (text === SUPPORT_CANCEL) {
      if (ctx.from) leaveSupportMode(ctx.from.id);
      await replyWithKeyboard(ctx, "Ок, не жду сообщение в поддержку.");
      return;
    }
    await next();
  });

  bot.on("message", async (ctx) => {
    const user = ctx.from;
    if (!user || !ctx.message) return;

    if (isConfiguredSupportUser(user)) {
      const replyTo = ctx.message.reply_to_message;
      const repliedText = replyTo && "text" in replyTo ? replyTo.text ?? "" : "";
      const application = parseTeacherApplicationMessage(repliedText);
      if (application) {
        const command = ctx.message.text?.trim().toLowerCase() ?? "";
        if (command !== "одобрить" && command !== "отклонить") {
          await ctx.reply("Ответьте на эту заявку «одобрить» или «отклонить».");
          return;
        }
        try {
          if (command === "отклонить") {
            const told = await notifyApplicant(ctx, application.telegramUserId, TEACHER_REJECTION_MESSAGE);
            await ctx.reply(told ? "Отклонено. Преподавателю написали." : "Отклонено, но написать преподавателю не удалось — пусть откроет бота.");
            return;
          }
          const decision = await acceptTeacherApplication(application);
          const told = decision.userMessage
            ? await notifyApplicant(ctx, decision.telegramUserId, decision.userMessage)
            : false;
          const note = decision.userMessage
            ? told
              ? "Преподавателю написали."
              : "Написать преподавателю не удалось — пусть откроет бота."
            : "";
          await ctx.reply([decision.summary, note].filter(Boolean).join("\n"));
        } catch (error) {
          await ctx.reply(error instanceof Error ? error.message : "Не удалось разобрать заявку");
        }
        return;
      }
      const ticketUserId = userIdFromRepliedMessage(replyTo);
      if (ticketUserId) {
        await deliverSupportReply(ctx, ticketUserId);
        return;
      }
      if (hasDeliverableContent(ctx.message) && !isAwaitingSupport(user.id)) {
        await ctx.reply(SUPPORT_REPLY_HINT);
        return;
      }
    }

    if (isAwaitingSupport(user.id) && hasDeliverableContent(ctx.message)) {
      await deliverUserMessage(ctx);
    }
  });

  bot.catch((error) => {
    console.error("bot error", error);
  });
  return bot;
}
