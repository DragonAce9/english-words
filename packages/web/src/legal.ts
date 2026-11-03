import legalData from "../../../data/legal.json";

export type LegalDoc = "terms" | "privacy";

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
  after?: string[];
}

export interface LegalDocument {
  id: LegalDoc;
  title: string;
  short: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

const CONTACT_TOKEN = "@contact";

export const LEGAL_CONTACT: string = legalData.contact;

function withContact(lines: string[] | undefined): string[] | undefined {
  return lines?.map((line) => (line === CONTACT_TOKEN ? LEGAL_CONTACT : line));
}

function buildDoc(id: LegalDoc): LegalDocument {
  const raw = legalData[id];
  return {
    id,
    title: raw.title,
    short: raw.short,
    updated: legalData.updated,
    intro: raw.intro,
    sections: raw.sections.map((section) => ({
      heading: section.heading,
      paragraphs: withContact("paragraphs" in section ? section.paragraphs : undefined),
      items: "items" in section ? section.items : undefined,
      after: "after" in section ? section.after : undefined,
    })),
  };
}

export const TERMS: LegalDocument = buildDoc("terms");
export const PRIVACY: LegalDocument = buildDoc("privacy");

export const LEGAL_DOCS: Record<LegalDoc, LegalDocument> = {
  terms: TERMS,
  privacy: PRIVACY,
};

export function otherLegalDoc(doc: LegalDoc): LegalDoc {
  return doc === "terms" ? "privacy" : "terms";
}

export function readLegalDoc(location = window.location): LegalDoc | null {
  const hash = location.hash.replace(/^#\/?/, "").split("?")[0].replace(/\/$/, "");
  if (hash === "terms" || hash === "privacy") return hash;
  const path = location.pathname.replace(/^\//, "").replace(/\/$/, "");
  if (path === "terms" || path === "privacy") return path;
  return null;
}

/** Telegram keeps init data in the URL hash. Replacing it reloads the Mini App and the legal screen never stays open. */
function telegramOwnsLocation(): boolean {
  return Boolean(window.Telegram?.WebApp);
}

export function openLegalUrl(doc: LegalDoc): void {
  if (telegramOwnsLocation()) return;
  if (readLegalDoc() === doc) return;
  window.location.hash = `/${doc}`;
}

export function clearLegalUrl(): void {
  if (telegramOwnsLocation()) return;
  const { pathname, search, hash } = window.location;
  if (hash) {
    window.history.replaceState(null, "", `${pathname}${search}`);
    return;
  }
  if (pathname === "/terms" || pathname === "/privacy") {
    window.history.replaceState(null, "", "/");
  }
}
