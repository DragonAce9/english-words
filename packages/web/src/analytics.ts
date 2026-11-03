import posthog from "posthog-js";
import { isInsideTelegram, telegramUser } from "./telegram";

/** Screen fields the Mini App can describe without pulling in view state. */
export type AnalyticsScreen = {
  name: string;
  section?: string;
  theme?: { id: string; title?: string; kind?: string };
  show?: { id: string; title?: string; kind?: string };
  mode?: string;
  level?: string | null;
  locked?: boolean;
  reason?: string;
  from?: string;
  step?: number;
  doc?: string;
};

let ready = false;
let identified = false;

function token(): string {
  return import.meta.env.VITE_POSTHOG_KEY?.trim() ?? "";
}

export function analyticsEnabled(): boolean {
  return ready;
}

/** Stable key so a refreshed theme object does not count as a new screen. */
export function screenAnalyticsKey(screen: AnalyticsScreen): string {
  const themeId = screen.theme?.id ?? screen.show?.id ?? "";
  return [
    screen.name,
    screen.section ?? "",
    themeId,
    screen.mode ?? "",
    screen.level ?? "",
    screen.doc ?? "",
    screen.reason ?? "",
    screen.from ?? "",
    screen.step ?? "",
    screen.locked ? "locked" : "",
  ].join("|");
}

function screenPath(screen: AnalyticsScreen): string {
  if (screen.name === "first-session" && screen.section) return `/first-session/${screen.section}`;
  if (screen.name === "list" && screen.section) return `/list/${screen.section}`;
  if (screen.name === "series" && screen.show) return `/series/${screen.show.id}`;
  if ((screen.name === "theme" || screen.name === "words") && screen.theme) {
    return `/${screen.name}/${screen.theme.id}`;
  }
  if ((screen.name === "session" || screen.name === "known") && screen.theme && screen.mode) {
    return `/${screen.name}/${screen.mode}/${screen.theme.id}`;
  }
  if (screen.name === "legal" && screen.doc) return `/legal/${screen.doc}`;
  if (screen.name === "teachers") return screen.locked ? "/teachers/locked" : "/teachers";
  if (screen.name === "paywall" && screen.step) return `/paywall/first-session/${screen.step}`;
  if (screen.name === "paywall" && screen.reason) return `/paywall/${screen.reason}`;
  if (screen.name === "paywall" && screen.from) return `/paywall/${screen.from}`;
  if (screen.name === "paywall" && screen.theme) return `/paywall/${screen.theme.id}`;
  return `/${screen.name}`;
}

function screenProperties(screen: AnalyticsScreen): Record<string, string | boolean> {
  const theme = screen.theme ?? screen.show;
  const props: Record<string, string | boolean> = { screen: screen.name };
  if (screen.section) props.section = screen.section;
  if (theme?.id) props.theme_id = theme.id;
  if (theme?.title) props.theme_title = theme.title;
  if (theme?.kind) props.theme_kind = theme.kind;
  if (screen.mode) props.mode = screen.mode;
  if (screen.level) props.level = screen.level;
  if (screen.locked) props.locked = true;
  if (screen.reason) props.reason = screen.reason;
  if (screen.from) props.from = screen.from;
  if (screen.step) props.step = String(screen.step);
  if (screen.doc) props.doc = screen.doc;
  return props;
}

export function initAnalytics(): void {
  const projectToken = token();
  if (!projectToken || ready) return;
  const user = telegramUser();
  try {
    posthog.init(projectToken, {
      api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com",
      defaults: "2026-08-30",
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
      persistence: "localStorage",
      session_recording: {
        recordHeaders: false,
        recordBody: false,
      },
      bootstrap: user ? { distinctID: String(user.id), isIdentifiedID: true } : undefined,
    });
  } catch {
    return;
  }
  ready = true;
  posthog.register({
    surface: isInsideTelegram() ? "telegram" : "browser",
  });
  if (!user) return;
  posthog.identify(String(user.id), {
    telegram_username: user.username,
    language: user.language_code,
    telegram_premium: Boolean(user.is_premium),
  });
  identified = true;
}

export function syncLearner(input: { subscribed: boolean; devUser: boolean }): void {
  if (!ready) return;
  posthog.register({
    subscribed: input.subscribed,
    dev_user: input.devUser,
  });
  if (!identified && input.devUser) {
    posthog.identify("dev-1", {
      subscribed: input.subscribed,
      dev_user: true,
    });
    identified = true;
    return;
  }
  if (!identified) return;
  posthog.setPersonProperties({
    subscribed: input.subscribed,
    dev_user: input.devUser,
  });
}

export function trackScreen(screen: AnalyticsScreen): void {
  if (!ready) return;
  const path = screenPath(screen);
  posthog.capture("$pageview", {
    ...screenProperties(screen),
    $current_url: `${window.location.origin}${path}`,
    $pathname: path,
  });
}

export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  if (!ready) return;
  posthog.capture(event, properties);
}
