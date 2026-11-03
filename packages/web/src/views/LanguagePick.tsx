import { languageFlag } from "../languageFlag";
import { isInsideTelegram } from "../telegram";
import type { LanguageOption } from "../types";
import { ScreenHeader } from "./ScreenHeader";

export function LanguagePick({
  languages,
  busy,
  title,
  onChoose,
  onBack,
}: {
  languages: LanguageOption[];
  busy: boolean;
  title: string;
  onChoose: (code: string) => void;
  onBack?: () => void;
}) {
  return (
    <div className="stack language-pick">
      {isInsideTelegram() ? <ScreenHeader title={title} /> : <h1>{title}</h1>}
      <p className="word-list-hint">Значения и кнопки остаются на русском.</p>
      {languages.map((language) => {
        const flag = languageFlag(language.code);
        return (
          <button
            key={language.code}
            type="button"
            className="primary language-option"
            disabled={busy}
            onClick={() => onChoose(language.code)}
          >
            {flag ? (
              <span className="language-flag" aria-hidden="true">
                {flag}
              </span>
            ) : null}
            {language.title}
          </button>
        );
      })}
      {onBack && !isInsideTelegram() ? (
        <button type="button" className="ghost" disabled={busy} onClick={onBack}>
          Назад
        </button>
      ) : null}
    </div>
  );
}
