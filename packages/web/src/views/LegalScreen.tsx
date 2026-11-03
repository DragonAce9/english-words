import { useEffect } from "react";
import { LEGAL_DOCS, otherLegalDoc, type LegalDoc, type LegalSection } from "../legal";
import { BOT_USERNAME, openBotSupport } from "../telegram";
import { ScreenHeader } from "./ScreenHeader";

const URL_RE = /(https:\/\/[^\s]+)/g;

function LegalText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^(https:\/\/[^\s]+?)([.,;:)]*)$/);
        if (!match) return part;
        const [, href, tail] = match;
        return (
          <span key={`${href}-${index}`}>
            <a href={href} target="_blank" rel="noreferrer">
              {href}
            </a>
            {tail}
          </span>
        );
      })}
    </>
  );
}

function Section({ section }: { section: LegalSection }) {
  return (
    <section className="card legal-section">
      <h2>{section.heading}</h2>
      {section.paragraphs?.map((text) => (
        <p key={text}>
          <LegalText text={text} />
        </p>
      ))}
      {section.items?.length ? (
        <ul className="legal-list">
          {section.items.map((text) => (
            <li key={text}>
              <LegalText text={text} />
            </li>
          ))}
        </ul>
      ) : null}
      {section.after?.map((text) => (
        <p key={text}>
          <LegalText text={text} />
        </p>
      ))}
    </section>
  );
}

export function LegalScreen({
  doc,
  onBack,
  onOpen,
}: {
  doc: LegalDoc;
  onBack: () => void;
  onOpen: (doc: LegalDoc) => void;
}) {
  const page = LEGAL_DOCS[doc];
  const other = LEGAL_DOCS[otherLegalDoc(doc)];

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [doc]);

  return (
    <article className="legal-screen">
      <ScreenHeader title={page.title} onBack={onBack} />
      <p className="legal-updated">Редакция от {page.updated}</p>
      <p className="legal-intro">
        <LegalText text={page.intro} />
      </p>
      {page.sections.map((section) => (
        <Section key={section.heading} section={section} />
      ))}
      <div className="legal-footer">
        <button type="button" className="ghost" onClick={() => onOpen(other.id)}>
          {other.title}
        </button>
        {BOT_USERNAME ? (
          <button type="button" className="ghost" onClick={openBotSupport}>
            Написать в поддержку
          </button>
        ) : null}
      </div>
    </article>
  );
}
