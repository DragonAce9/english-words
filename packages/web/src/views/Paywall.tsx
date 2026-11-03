import type { LegalDoc } from "../legal";
import type { ThemeSummary } from "../types";
import { LegalConsent } from "./LegalLinks";
import { ScreenHeader } from "./ScreenHeader";
import { TributePlans } from "./TributePlans";

export function Paywall({
  theme,
  reason,
  subscribeUrl,
  subscribeYearlyUrl,
  source = "paywall",
  onBack,
  onOpenLegal,
}: {
  theme?: ThemeSummary;
  reason?: "teachers";
  subscribeUrl: string;
  subscribeYearlyUrl?: string;
  source?: string;
  onBack: () => void;
  onOpenLegal: (doc: LegalDoc) => void;
}) {
  const copy =
    reason === "teachers"
      ? "Напиши преподавателю в Telegram. Лента открывается с полным доступом."
      : theme?.kind === "movie" || theme?.kind === "episode" || theme?.kind === "series"
        ? `«${theme.title}» в полном доступе, как и остальные фильмы и сериалы. Бесплатно можно взять один.`
        : theme
          ? `«${theme.title}» в полном доступе. Бесплатно: 10 тем, один свой текст и один фильм или сериал.`
          : "Все темы, фильмы, сериалы, свои тексты и преподаватели.";

  return (
    <>
      <ScreenHeader title="Оплата" onBack={onBack} />
      <p className="pay-lead">{copy}</p>
      <ul className="pay-includes">
        <li>Все темы, от A1 до C2</li>
        <li>Фильмы, сериалы и свои тексты</li>
        <li>Преподаватели, которым можно написать</li>
      </ul>
      <TributePlans subscribeUrl={subscribeUrl} subscribeYearlyUrl={subscribeYearlyUrl} source={source} />
      <p className="legal-pay-note">Оплата, продление, отмена и возвраты — через Tribute.</p>
      <LegalConsent onOpen={onOpenLegal} />
    </>
  );
}
