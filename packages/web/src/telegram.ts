export type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";

export type TelegramUser = {
  id: number;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

type TelegramInset = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  requestFullscreen?: () => void;
  isFullscreen?: boolean;
  initData: string;
  initDataUnsafe?: {
    user?: TelegramUser;
    start_param?: string;
  };
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
  themeParams?: Record<string, string>;
  colorScheme?: "light" | "dark";
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
  addToHomeScreen?: () => void;
  checkHomeScreenStatus?: (callback?: (status: HomeScreenStatus) => void) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
};

const INSET_SIDES = ["top", "right", "bottom", "left"] as const;

function insetValue(inset: TelegramInset | undefined, side: (typeof INSET_SIDES)[number]): number {
  const value = inset?.[side];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function insetPx(inset: TelegramInset | undefined, side: (typeof INSET_SIDES)[number]): string {
  const value = insetValue(inset, side);
  return value === 0 ? "0px" : `${value}px`;
}

function insetsAreZero(inset: TelegramInset | undefined): boolean {
  return INSET_SIDES.every((side) => insetValue(inset, side) === 0);
}

/**
 * contentSafeAreaInset already includes the system safe area and Telegram chrome.
 * Adding safeAreaInset on top of it leaves an empty band under the Telegram bar.
 * Older clients report content insets as all zeros; those fall back to safeAreaInset.
 * The home counter uses this same shell plus the title insets. It does not get
 * a second header-row margin.
 */
function shellInset(webApp: TelegramWebApp): TelegramInset | undefined {
  return insetsAreZero(webApp.contentSafeAreaInset) ? webApp.safeAreaInset : webApp.contentSafeAreaInset;
}

/**
 * One header control, when fullscreen reports no side inset and the title row
 * actually sits beside those controls. Wider than a glyph, narrower than the
 * old 96px reserve that cut «Какой язык учим?» down to «Какой яз…».
 */
const FULLSCREEN_TITLE_SIDE_PX = 64;
/** Content inset must clear the device safe area by this much before the title moves into that header row. */
const TITLE_BAND_MIN_PX = 20;

function titleSideInset(
  content: TelegramInset | undefined,
  side: "left" | "right",
  fullscreen: boolean,
  sharesButtonRow: boolean,
): number {
  if (!insetsAreZero(content)) {
    const reported = insetValue(content, side);
    if (reported > 0) return reported;
  }
  // A reported inset of 0 means the buttons are not in this row. Reserving a
  // pill there only shrinks the title. Keep the reserve when the row is the
  // fullscreen header and Telegram has not described it yet.
  return fullscreen && sharesButtonRow ? FULLSCREEN_TITLE_SIDE_PX : 0;
}

/** Home counter shares Telegram's button row. A screen heading below that row does not. */
function titleSharesButtonRow(webApp: TelegramWebApp, band: number): boolean {
  if (band > 0) return true;
  return webApp.isFullscreen === true && insetsAreZero(webApp.contentSafeAreaInset);
}

/**
 * The home counter sits in Telegram's header row.
 * When contentSafeAreaInset.top extends past the device safe area, that whole content top
 * is the row (status bar plus controls). It is not added to safeAreaInset.
 * Screen headings are not placed in that row. They wrap in the content below it.
 */
function titleBandPx(webApp: TelegramWebApp): number {
  if (insetsAreZero(webApp.contentSafeAreaInset)) return 0;
  const contentTop = insetValue(webApp.contentSafeAreaInset, "top");
  const safeTop = insetValue(webApp.safeAreaInset, "top");
  if (contentTop - safeTop < TITLE_BAND_MIN_PX) return 0;
  return contentTop;
}

function applyTelegramSafeArea(webApp: TelegramWebApp): void {
  const root = document.documentElement;
  const inset = shellInset(webApp);
  for (const side of INSET_SIDES) {
    root.style.setProperty(`--tg-shell-inset-${side}`, insetPx(inset, side));
  }
  root.style.removeProperty("--tg-content-inset-top");
  root.style.removeProperty("--tg-home-top");
  const fullscreen = webApp.isFullscreen === true;
  const band = titleBandPx(webApp);
  const sharesButtonRow = titleSharesButtonRow(webApp, band);
  root.style.setProperty("--tg-title-band", band === 0 ? "0px" : `${band}px`);
  root.style.setProperty(
    "--tg-title-inset-left",
    `${titleSideInset(webApp.contentSafeAreaInset, "left", fullscreen, sharesButtonRow)}px`,
  );
  root.style.setProperty(
    "--tg-title-inset-right",
    `${titleSideInset(webApp.contentSafeAreaInset, "right", fullscreen, sharesButtonRow)}px`,
  );
  root.dataset.tg = "1";
  if (band > 0) root.dataset.tgBand = "1";
  else delete root.dataset.tgBand;
}

let fullscreenRequested = false;

/** One attempt. fullscreenFailed and a missing method both leave the expanded sheet as-is. */
function requestTelegramFullscreen(webApp: TelegramWebApp): void {
  if (fullscreenRequested || typeof webApp.requestFullscreen !== "function") return;
  fullscreenRequested = true;
  try {
    webApp.requestFullscreen();
  } catch {
    // Stay expanded. Do not retry and do not surface an error.
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function bootTelegram(): TelegramWebApp | undefined {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return undefined;
  webApp.ready();
  // telegram-web-app.js also creates WebApp in a normal browser. Viewport calls
  // belong to a real Mini App launch, which is the only place initData is set.
  if (!webApp.initData) return webApp;

  webApp.expand();
  applyTelegramSafeArea(webApp);
  const syncInsets = () => applyTelegramSafeArea(webApp);
  webApp.onEvent?.("safeAreaChanged", syncInsets);
  webApp.onEvent?.("contentSafeAreaChanged", syncInsets);
  webApp.onEvent?.("fullscreenChanged", syncInsets);
  // Async refusal (unsupported client, already fullscreen). Do not call requestFullscreen again.
  webApp.onEvent?.("fullscreenFailed", () => undefined);
  requestTelegramFullscreen(webApp);
  return webApp;
}

export function getInitData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData ?? "";
}

export function telegramUser(): TelegramUser | null {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!user || typeof user.id !== "number") return null;
  return user;
}

export function isInsideTelegram(): boolean {
  return Boolean(getInitData());
}

export const BOT_USERNAME = "YOUR_BOT_USERNAME";
export const MOTI_CHANNEL_URL = "https://t.me/YOUR_CHANNEL_USERNAME";

export function openMotiChannel(): void {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(MOTI_CHANNEL_URL);
    return;
  }
  window.open(MOTI_CHANNEL_URL, "_blank", "noopener,noreferrer");
}

export function botSupportUrl(): string {
  return `https://t.me/${BOT_USERNAME}?start=support`;
}

/** Opens Telegram's share sheet. Returns false outside the Mini App so the caller can show the link. */
export function openTelegramShare(url: string, text: string): boolean {
  const webApp = window.Telegram?.WebApp;
  if (!isInsideTelegram() || !webApp?.openTelegramLink) return false;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  try {
    webApp.openTelegramLink(shareUrl);
    return true;
  } catch {
    return false;
  }
}

export function openBotSupport(): void {
  if (!BOT_USERNAME) return;
  const url = botSupportUrl();
  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The same Tribute product has two checkouts.
 * Telegram (`t.me/tribute/app?startapp=pYOUR_MONTHLY_PRODUCT`) takes Stars only: that is Telegram's rule for digital goods.
 * The web page (`https://web.tribute.tg/p/YOUR_MONTHLY_PRODUCT`) opens in a browser, where a bank card works.
 * @tribute is the live bot; the older `tribute_bot` example is a different account.
 */
export function tributeTelegramLink(productUrl: string): string {
  const raw = productUrl.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.toLowerCase();
  if (host === "t.me" || host === "telegram.me") {
    url.protocol = "https:";
    url.hostname = "t.me";
    return url.toString();
  }
  if (host === "web.tribute.tg") {
    const slug = url.pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
    if (slug) return `https://t.me/tribute/app?startapp=p${slug[1]}`;
  }
  return raw;
}

/** Browser checkout for the same product. A Telegram startapp slug maps back to web.tribute.tg. */
export function tributeWebLink(productUrl: string): string {
  const raw = productUrl.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.toLowerCase();
  if (host === "web.tribute.tg") return url.toString();
  if (host === "t.me" || host === "telegram.me") {
    const slug = (url.searchParams.get("startapp") ?? "").match(/^p([A-Za-z0-9_-]+)$/);
    if (slug) return `https://web.tribute.tg/p/${slug[1]}`;
  }
  return raw;
}

function isTelegramLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "t.me" || host === "telegram.me";
  } catch {
    return false;
  }
}

/** Opens the Tribute product in Telegram, where payment is Stars. Returns false when the page should follow the link itself. */
export function openTributeProduct(productUrl: string): boolean {
  const target = tributeTelegramLink(productUrl);
  const openTelegramLink = window.Telegram?.WebApp?.openTelegramLink;
  if (!isTelegramLink(target) || !openTelegramLink) return false;
  try {
    openTelegramLink(target);
    return true;
  } catch {
    return false;
  }
}

/** Opens the Tribute web checkout in a browser, where a bank card works. */
export function openTributeWeb(productUrl: string): boolean {
  const target = tributeWebLink(productUrl);
  const openLink = window.Telegram?.WebApp?.openLink;
  if (!openLink) return false;
  try {
    openLink(target);
    return true;
  } catch {
    return false;
  }
}

export function checkHomeScreenStatus(): Promise<HomeScreenStatus> {
  const check = window.Telegram?.WebApp?.checkHomeScreenStatus;
  if (!check) return Promise.resolve("unsupported");
  return new Promise((resolve) => {
    let settled = false;
    const done = (status: HomeScreenStatus) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    check(done);
    window.setTimeout(() => done("unknown"), 2000);
  });
}

export function canOfferHomeScreen(status: HomeScreenStatus): boolean {
  return status === "missed" || status === "unknown";
}

export function promptAddToHomeScreen(): boolean {
  const webApp = window.Telegram?.WebApp;
  if (!webApp?.addToHomeScreen) return false;
  webApp.addToHomeScreen();
  return true;
}

let telegramBackHandler: (() => void) | null = null;
let telegramBackListening = false;

function onTelegramBackClick(): void {
  telegramBackHandler?.();
}

/**
 * One BackButton listener for the whole Mini App. Replace the action when the screen changes.
 * Pass null on home so Telegram shows «Закрыть» instead of «Назад».
 * No-op outside a real Mini App (empty initData), including the browser dev shell.
 */
export function setTelegramBackHandler(handler: (() => void) | null): void {
  if (!isInsideTelegram()) return;
  const back = window.Telegram?.WebApp?.BackButton;
  if (!back) return;
  telegramBackHandler = handler;
  if (!telegramBackListening) {
    back.onClick(onTelegramBackClick);
    telegramBackListening = true;
  }
  if (handler) back.show();
  else back.hide();
}

export function onHomeScreenAdded(handler: () => void): () => void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp?.onEvent) return () => undefined;
  webApp.onEvent("homeScreenAdded", handler);
  return () => webApp.offEvent?.("homeScreenAdded", handler);
}
