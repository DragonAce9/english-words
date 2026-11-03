import { serve } from "@hono/node-server";
import { InlineKeyboard } from "grammy";
import { createApp } from "./app.js";
import { createBot } from "./bot.js";
import { config } from "./config.js";
import { startDailyFacts } from "./dailyFact.js";
import { sql } from "./db.js";
import { loadSharedCatalog } from "./catalog.js";
import { loadDictionaries } from "./dictionary.js";
import { migrate } from "./migrate.js";
import { setCatalogRequestNotifier } from "./catalogRequests.js";
import { applyStoredFixes, deliverReportToSupport, setReportNotifier } from "./reports.js";
import { deliverTeacherApplication, setTeacherApplicationNotifier } from "./teachers.js";
import { resolveSupportChatId } from "./support.js";
import { warmWordtron } from "./wordtron.js";

async function main() {
  await migrate();
  await loadDictionaries();
  await loadSharedCatalog();
  await applyStoredFixes();
  await warmWordtron();
  const app = createApp();
  const bot = createBot();
  setReportNotifier(async (report) => {
    if (!bot) throw new Error("bot is not configured");
    await deliverReportToSupport(report, {
      getChat: (chatId) => bot.api.getChat(chatId),
      sendMessage: (chatId, text, extra) => bot.api.sendMessage(chatId, text, extra),
    });
  });
  setTeacherApplicationNotifier(async (notice) => {
    if (!bot) throw new Error("bot is not configured");
    await deliverTeacherApplication(notice, {
      getChat: (chatId) => bot.api.getChat(chatId),
      sendMessage: (chatId, message, extra) => bot.api.sendMessage(chatId, message, extra),
    });
  });
  setCatalogRequestNotifier(async (text) => {
    if (!bot) return;
    const target = await resolveSupportChatId((chatId) => bot.api.getChat(chatId));
    if (target == null) {
      console.error("catalog request: no support chat");
      return;
    }
    await bot.api.sendMessage(target, text);
  });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.info(`api listening on http://localhost:${info.port}`);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `port ${config.port} already in use — stop the other API (docker compose stop api, or the other npm run dev:api) and retry`,
      );
    } else {
      console.error(error);
    }
    process.exit(1);
  });

  if (bot) {
    bot.start({
      onStart: (me) => console.info(`bot @${me.username} started`),
    });
  }

  const stopFacts = startDailyFacts(
    bot
      ? async (text) => {
          const keyboard = new InlineKeyboard().url("Открыть Моти", `https://t.me/${config.botUsername}`);
          await bot.api.sendMessage(config.factChannelId, text, { reply_markup: keyboard });
        }
      : null,
  );

  const shutdown = async () => {
    stopFacts();
    if (bot) await bot.stop();
    server.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
