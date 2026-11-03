/** Flag emoji for the studied language. Renders in Telegram without image assets. */
const FLAGS: Record<string, string> = {
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

export function languageFlag(code: string): string {
  return FLAGS[code] ?? "";
}
