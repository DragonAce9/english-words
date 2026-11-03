import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { freeMediaIdFor } from "./access.js";
import { AuthError, resolveUser, runAsUser } from "./auth.js";
import { config } from "./config.js";
import { pingDb, sql } from "./db.js";
import { isAvailableLanguage, languageState } from "./languages.js";
import { dictionary } from "./dictionary.js";
import { collectMetrics, httpDuration, progressWritten, sessionStarted } from "./metrics.js";
import { loadGuideTries, markGuideTry, markOnboardingDone } from "./onboarding.js";
import { createFirstSessionPack } from "./firstSession.js";
import { loadUnlockedFact, unlockDailyFact } from "./dailyFact.js";
import { careForPet, loadAndTickPet } from "./pet.js";
import { claimReferralReward, loadReferralRewards, loadReferralSummary, loadReferralUnlocks } from "./referrals.js";
import { saveProgress } from "./progress.js";
import { lookupDictionary, searchDictionary } from "./lookup.js";
import { loadUserStats } from "./stats.js";
import { createExam } from "./exam.js";
import { gradeRecall, parseDay, utcDay } from "./recall.js";
import { createSession, HttpError } from "./session.js";
import {
  createTeacher,
  deleteTeacher,
  hasTeacherProfile,
  leaveTeacherList,
  isListedForEveryTeachLanguage,
  isListedTeacher,
  isTeacherAdmin,
  listTeachersShuffled,
  namedTeachLanguages,
  readTeacherPhoto,
  refreshTeacherPhoto,
  submitTeacherApplication,
} from "./teachers.js";
import { analyzeTexts, deleteUserText, listUserTexts } from "./texts.js";
import { addStudyWord } from "./studyWords.js";
import {
  guessWordtron,
  hintWordtron,
  startWordtronGame,
  studyWordtronGuess,
  surrenderWordtron,
  wordtronPreviewEnabled,
  wordtronState,
} from "./wordtron.js";
import { enrollStudyingMany, unenrollStudying } from "./studying.js";
import { isCefrLevel, listThemeCatalog, listThemeWords } from "./themes.js";
import { renderLegalHtml } from "./legal.js";
import { handleTributeWebhook } from "./tribute.js";
import { createWordReport } from "./reports.js";
import { createCatalogRequest } from "./catalogRequests.js";
import type { PetAction, ProgressItem, SessionMode } from "./types.js";

type Variables = {
  user: Awaited<ReturnType<typeof resolveUser>>;
};

export function createApp() {
  const app = new Hono<{ Variables: Variables }>();

  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    httpDuration.record(performance.now() - started, {
      method: c.req.method,
      route: c.req.path,
      status: String(c.res.status),
    });
  });

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "X-Telegram-Init-Data"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/terms", (c) => c.html(renderLegalHtml("terms")));
  app.get("/privacy", (c) => c.html(renderLegalHtml("privacy")));

  app.get("/health", async (c) => {
    await pingDb();
    return c.json({
      ok: true,
      themes: dictionary.themes.size,
      words: dictionary.words.size,
    });
  });

  app.get("/metrics", async (c) => {
    const body = await collectMetrics();
    return c.text(body, 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  app.post("/webhook/tribute", async (c) => {
    const raw = await c.req.text();
    try {
      const result = await handleTributeWebhook(raw, c.req.header("trbt-signature"));
      return c.json(result);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return c.json({ error: (error as Error).message }, status as 401);
    }
  });

  app.use("/me", authMiddleware);
  app.use("/me/*", authMiddleware);
  app.use("/themes", authMiddleware);
  app.use("/themes/*", authMiddleware);
  app.use("/sessions", authMiddleware);
  app.use("/review", authMiddleware);
  app.use("/exam", authMiddleware);
  app.use("/studying", authMiddleware);
  app.use("/progress", authMiddleware);
  app.use("/stats", authMiddleware);
  app.use("/dictionary", authMiddleware);
  app.use("/dictionary/*", authMiddleware);
  app.use("/wordtron", authMiddleware);
  app.use("/wordtron/*", authMiddleware);
  app.use("/onboarding", authMiddleware);
  app.use("/onboarding/*", authMiddleware);
  app.use("/guide", authMiddleware);
  app.use("/pet", authMiddleware);
  app.use("/pet/actions", authMiddleware);
  app.use("/referral", authMiddleware);
  app.use("/referral/*", authMiddleware);
  app.get("/teachers/:id/photo", async (c) => {
    const photo = await readTeacherPhoto(c.req.param("id"));
    if (!photo) return c.json({ error: "Фото нет" }, 404);
    return new Response(photo.body, {
      status: 200,
      headers: {
        "Content-Type": photo.type,
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  app.use("/teachers", authMiddleware);
  app.use("/teachers/*", async (c, next) => {
    if (c.req.method === "GET" && c.req.path.endsWith("/photo")) return next();
    return authMiddleware(c, next);
  });
  app.use("/texts", authMiddleware);
  app.use("/texts/*", authMiddleware);
  app.use("/reports", authMiddleware);
  app.use("/catalog-requests", authMiddleware);

  app.post("/reports", async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const report = await createWordReport(user, body as { wordId?: string; themeId?: string; reason?: string; comment?: string });
    return c.json({ ok: true, id: report.id });
  });

  app.post("/catalog-requests", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string; title?: string; comment?: string };
    const request = await createCatalogRequest(user, body);
    return c.json({ ok: true, id: request.id });
  });

  app.get("/themes", async (c) => {
    const user = c.get("user");
    const [catalog, guideTries, listedTeacher] = await Promise.all([
      listThemeCatalog(user),
      loadGuideTries(user.id),
      isListedTeacher(user),
    ]);
    return c.json({
      themes: catalog.themes,
      blocks: catalog.blocks,
      catalogWordCount: catalog.catalogWordCount,
      subscribed: user.subscribed,
      listedTeacher,
      subscribeUrl: config.tributeSubscribeUrl,
      subscribeYearlyUrl: config.tributeSubscribeYearlyUrl,
      botUsername: config.botUsername || undefined,
      devUser: user.dev,
      onboardingDone: user.onboardingDone,
      guideTries,
      ...languageState(user),
    });
  });

  app.get("/me", (c) => {
    const user = c.get("user");
    return c.json({ ...languageState(user), wordtronPreview: wordtronPreviewEnabled(user.telegramUserId) });
  });

  app.post("/me/language", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { language?: unknown };
    if (!isAvailableLanguage(body.language)) {
      return c.json({ error: "language is invalid", code: "invalid_language" }, 400);
    }
    await sql`
      UPDATE users
      SET language = ${body.language}, language_chosen = true
      WHERE id = ${user.id}::bigint
    `;
    user.language = body.language;
    user.languageChosen = true;
    user.freeMediaId = await freeMediaIdFor(user.id, body.language, null);
    user.referralUnlocks = await loadReferralUnlocks(user.id, body.language);
    return c.json({ ...languageState(user), wordtronPreview: wordtronPreviewEnabled(user.telegramUserId) });
  });

  app.get("/themes/:themeId/words", async (c) => {
    const user = c.get("user");
    const levelRaw = c.req.query("level");
    const level =
      levelRaw == null || levelRaw === "" || levelRaw === "all" ? null : levelRaw;
    if (level != null && !isCefrLevel(level)) {
      return c.json({ error: "level is invalid", code: "invalid_level" }, 400);
    }
    const categoryRaw = c.req.query("category");
    const categoryId = categoryRaw == null || categoryRaw === "" ? null : categoryRaw;
    const body = await listThemeWords(user, c.req.param("themeId"), level, categoryId);
    return c.json(body);
  });

  app.post("/sessions", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as {
      themeId?: string;
      mode?: SessionMode;
      level?: string | null;
      categoryId?: string | null;
      today?: unknown;
    };
    const mode = body.mode ?? "learn";
    if (!body.themeId) return c.json({ error: "themeId is required" }, 400);
    if (!["learn", "match", "control", "review"].includes(mode)) {
      return c.json({ error: "mode is invalid" }, 400);
    }
    const level = body.level == null || body.level === "" || body.level === "all" ? null : body.level;
    if (level != null && !isCefrLevel(level)) {
      return c.json({ error: "level is invalid", code: "invalid_level" }, 400);
    }
    const categoryId = body.categoryId == null || body.categoryId === "" ? null : body.categoryId;
    const today = parseDay(body.today) ?? utcDay();
    const session = await createSession(user, body.themeId, mode, level, categoryId, today);
    sessionStarted.add(1, { mode, theme: body.themeId });
    return c.json(session);
  });

  app.post("/review", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as {
      themeId?: string;
      mode?: string;
      wordId?: string;
      answer?: string;
      level?: string | null;
      categoryId?: string | null;
      today?: unknown;
    };
    if (!body.themeId) return c.json({ error: "themeId is required" }, 400);
    if (body.mode !== "control" && body.mode !== "review") {
      return c.json({ error: "mode is invalid" }, 400);
    }
    if (!body.wordId) return c.json({ error: "wordId is required" }, 400);
    const level = body.level == null || body.level === "" || body.level === "all" ? null : body.level;
    if (level != null && !isCefrLevel(level)) {
      return c.json({ error: "level is invalid", code: "invalid_level" }, 400);
    }
    const categoryId = body.categoryId == null || body.categoryId === "" ? null : body.categoryId;
    const result = await gradeRecall(user, {
      themeId: body.themeId,
      mode: body.mode,
      wordId: body.wordId,
      answer: typeof body.answer === "string" ? body.answer : "",
      level,
      categoryId,
      today: parseDay(body.today) ?? utcDay(),
    });
    return c.json(result);
  });

  app.post("/exam", async (c) => {
    const session = await createExam(c.get("user"));
    sessionStarted.add(1, { mode: "exam", theme: "studying" });
    return c.json(session);
  });

  app.post("/studying", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { themeIds?: unknown };
    const themeIds = Array.isArray(body.themeIds)
      ? body.themeIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    await enrollStudyingMany(user, themeIds);
    return c.json({ ok: true });
  });

  app.delete("/studying", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { themeIds?: unknown };
    const themeIds = Array.isArray(body.themeIds)
      ? body.themeIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    await unenrollStudying(user, themeIds);
    return c.json({ ok: true });
  });

  app.get("/stats", async (c) => {
    return c.json(await loadUserStats(c.get("user")));
  });

  app.get("/dictionary", async (c) => {
    return c.json(await searchDictionary(c.get("user"), c.req.query("q") ?? ""));
  });

  app.post("/dictionary", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string };
    return c.json(await lookupDictionary(c.get("user"), body.query ?? ""));
  });

  app.post("/dictionary/study", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { wordId?: string };
    if (!body.wordId) return c.json({ error: "wordId is required" }, 400);
    return c.json(await addStudyWord(user, body.wordId));
  });

  app.post("/progress", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { items?: ProgressItem[] };
    const result = await saveProgress(user, body.items ?? []);
    progressWritten.add(1, { items: result.updated });
    return c.json({ ok: true, ...result });
  });

  app.post("/onboarding", async (c) => {
    const user = c.get("user");
    const result = await markOnboardingDone(user);
    return c.json(result);
  });

  app.post("/onboarding/session", async (c) => {
    const user = c.get("user");
    const pack = await createFirstSessionPack(user);
    sessionStarted.add(1, { mode: "first_session", theme: pack.session.themeId });
    return c.json(pack);
  });

  app.post("/guide", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: string };
    return c.json(await markGuideTry(c.get("user"), body.id ?? ""));
  });

  app.get("/pet", async (c) => {
    const user = c.get("user");
    const [{ pet }, referral, fact] = await Promise.all([
      loadAndTickPet(user),
      loadReferralSummary(user.id),
      loadUnlockedFact(user.id),
    ]);
    return c.json({ pet, referral, fact });
  });

  app.get("/referral/rewards", async (c) => {
    return c.json(await loadReferralRewards(c.get("user")));
  });

  app.post("/referral/rewards", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { themeId?: string };
    const claimed = await claimReferralReward(user, body.themeId ?? "");
    return c.json({ ok: true, ...claimed, referral: await loadReferralSummary(user.id) });
  });

  app.post("/pet/actions", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { action?: PetAction };
    if (!body.action) return c.json({ error: "action is required" }, 400);
    const pet = await careForPet(user, body.action);
    const fact = await unlockDailyFact(user.id);
    return c.json({ pet, fact });
  });

  app.get("/teachers", async (c) => {
    const user = c.get("user");
    const admin = isTeacherAdmin(user);
    const teachers = await listTeachersShuffled(user.language);
    const listed = await isListedForEveryTeachLanguage(user);
    const ownProfile = await hasTeacherProfile(user);
    return c.json({
      teachers,
      admin,
      listed,
      ownProfile,
      teachLanguages: namedTeachLanguages(),
      account: {
        telegramUserId: user.telegramUserId,
        telegramUsername: user.telegramUsername,
      },
    });
  });

  app.post("/teachers/apply", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      bio?: string;
      languages?: unknown;
    };
    const result = await submitTeacherApplication(c.get("user"), body);
    return c.json(result);
  });

  app.post("/teachers", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      telegramUsername?: string;
      bio?: string;
    };
    const result = await createTeacher(c.get("user"), body);
    return c.json(result, 201);
  });

  app.post("/teachers/:id/photo", async (c) => {
    const result = await refreshTeacherPhoto(c.get("user"), c.req.param("id"));
    return c.json(result);
  });

  app.delete("/teachers/me", async (c) => {
    await leaveTeacherList(c.get("user"));
    return c.json({ ok: true });
  });

  app.delete("/teachers/:id", async (c) => {
    await deleteTeacher(c.get("user"), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/texts", async (c) => {
    const body = await listUserTexts(c.get("user"));
    return c.json(body);
  });

  app.post("/texts/analyze", async (c) => {
    const payload = (await c.req.json().catch(() => ({}))) as {
      texts?: { title?: string; body: string }[];
    };
    const analysis = await analyzeTexts(c.get("user"), payload.texts ?? []);
    const stored = await listUserTexts(c.get("user"));
    return c.json({ analysis, texts: stored.texts, quota: stored.quota });
  });

  app.get("/wordtron", async (c) => c.json(await wordtronState(c.get("user"))));

  app.post("/wordtron/games", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      level?: string | null;
      theme?: string | null;
      replace?: boolean;
      bots?: number;
    };
    return c.json(await startWordtronGame(c.get("user"), body));
  });

  app.post("/wordtron/guess", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { word?: string };
    return c.json(await guessWordtron(c.get("user"), body.word ?? ""));
  });

  app.post("/wordtron/hint", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string };
    return c.json(await hintWordtron(c.get("user"), body.kind ?? ""));
  });

  app.post("/wordtron/surrender", async (c) => c.json(await surrenderWordtron(c.get("user"))));

  app.post("/wordtron/study", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { word?: string };
    return c.json(await studyWordtronGuess(c.get("user"), body.word ?? ""));
  });

  app.delete("/texts/:textId", async (c) => {
    await deleteUserText(c.get("user"), c.req.param("textId"));
    return c.json(await listUserTexts(c.get("user")));
  });

  if (existsSync(config.webDist)) {
    const root = config.webDist;
    app.use("/assets/*", serveStatic({ root }));
    app.use("/moti/*", serveStatic({ root }));
    app.get("*", async (c, next) => {
      if (c.req.method !== "GET") return next();
      const html = await readFile(join(root, "index.html"), "utf8");
      return c.html(html);
    });
  }

  app.onError((error, c) => {
    if (error instanceof AuthError) return c.json({ error: error.message }, error.status as 401);
    if (error instanceof HttpError) {
      return c.json({ error: error.message, code: error.code }, error.status as 403);
    }
    console.error(error);
    return c.json({ error: "Internal error" }, 500);
  });

  return app;
}

async function authMiddleware(
  c: { req: { header: (name: string) => string | undefined }; set: (key: "user", value: Variables["user"]) => void },
  next: () => Promise<void>,
) {
  const user = await resolveUser(c.req.header("Authorization"), c.req.header("X-Telegram-Init-Data"));
  c.set("user", user);
  await runAsUser(user, () => next());
}
