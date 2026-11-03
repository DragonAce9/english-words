import { languageFlag } from "../languageFlag";
import { isInsideTelegram } from "../telegram";

function ruWordForm(count: number): "слово" | "слова" | "слов" {
  const n10 = Math.abs(count) % 10;
  const n100 = Math.abs(count) % 100;
  if (n100 >= 11 && n100 <= 14) return "слов";
  if (n10 === 1) return "слово";
  if (n10 >= 2 && n10 <= 4) return "слова";
  return "слов";
}

export function CatalogBar({
  count,
  language = "en",
  languageTitle,
  onOpenLanguage,
  subscribed = false,
}: {
  count: number;
  language?: string;
  languageTitle?: string;
  onOpenLanguage?: () => void;
  subscribed?: boolean;
}) {
  const formatted = count.toLocaleString("ru-RU");
  const word = ruWordForm(count);
  const title = languageTitle ?? "Английский";
  const flag = languageFlag(language);
  const inTelegram = isInsideTelegram();
  return (
    <>
      <div className={inTelegram ? "catalog-bar screen-title" : "catalog-bar"}>
        <div className="catalog-bar-count" role="status" aria-label={`${formatted} ${word}`}>
          <strong>{formatted}</strong>
          <span>{word}</span>
        </div>
      </div>
      {onOpenLanguage ? (
        <div className="home-lang-row">
          <button type="button" className="catalog-lang" onClick={onOpenLanguage}>
            {flag ? (
              <span className="language-flag" aria-hidden="true">
                {flag}
              </span>
            ) : null}
            <span>{title}</span>
          </button>
          {subscribed ? (
            <span className="access-chip" role="status">
              Полный доступ
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function AccessBanner({
  subscribed,
  texts = true,
  onOpen,
}: {
  subscribed: boolean;
  texts?: boolean;
  onOpen: () => void;
}) {
  if (subscribed) return null;

  return (
    <div className="access-banner access-banner-free">
      <div className="access-banner-copy">
        <strong>Бесплатный доступ</strong>
        <span>
          {texts
            ? "10 тем, 1 свой текст до 2000 знаков и 1 фильм или сериал на выбор"
            : "10 тем и 1 фильм или сериал на выбор"}
        </span>
      </div>
      <button type="button" className="pay-pill" onClick={onOpen}>
        Полный доступ
      </button>
    </div>
  );
}
