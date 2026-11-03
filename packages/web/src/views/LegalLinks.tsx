import type { LegalDoc } from "../legal";
import { BOT_USERNAME, openBotSupport } from "../telegram";

function LegalLink({ doc, onOpen, children }: { doc: LegalDoc; onOpen: (doc: LegalDoc) => void; children: string }) {
  return (
    <button type="button" className="legal-link" onClick={() => onOpen(doc)}>
      {children}
    </button>
  );
}

/** One-line consent: using the service (free or paid) means accepting the documents. */
export function LegalConsent({
  onOpen,
  className,
  support = false,
}: {
  onOpen: (doc: LegalDoc) => void;
  className?: string;
  /** Home only: support sits on the consent line and wraps under it when the line is full. */
  support?: boolean;
}) {
  return (
    <p className={className ? `legal-consent ${className}` : "legal-consent"}>
      Пользуясь сервисом, вы принимаете{" "}
      <LegalLink doc="terms" onOpen={onOpen}>
        Условия
      </LegalLink>{" "}
      и{" "}
      <LegalLink doc="privacy" onOpen={onOpen}>
        Политику конфиденциальности
      </LegalLink>
      .
      {support && BOT_USERNAME ? (
        <>
          {" "}
          <button type="button" className="legal-link" onClick={openBotSupport}>
            Поддержка
          </button>
        </>
      ) : null}
    </p>
  );
}
