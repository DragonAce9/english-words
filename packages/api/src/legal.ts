import { readFileSync } from "node:fs";
import { config } from "./config.js";

export type LegalDocId = "terms" | "privacy";

interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
  after?: string[];
}

interface LegalPage {
  title: string;
  short: string;
  intro: string;
  sections: LegalSection[];
}

interface LegalFile {
  updated: string;
  contact: string;
  terms: LegalPage;
  privacy: LegalPage;
}

const CONTACT_TOKEN = "@contact";

// Single source of truth shared with packages/web (imported there via Vite JSON import).
// src/ and dist/ sit at the same depth, so the relative path works for tsx and the built image.
const LEGAL_PATH = new URL("../../../data/legal.json", import.meta.url);

let cached: LegalFile | null = null;

export function loadLegal(): LegalFile {
  if (!cached) cached = JSON.parse(readFileSync(LEGAL_PATH, "utf8")) as LegalFile;
  return cached;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function linkify(text: string): string {
  return escapeHtml(text).replace(/https:\/\/[^\s<]+?(?=[.,;:)]*(?:\s|$))/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`;
  });
}

export function renderLegalHtml(id: LegalDocId): string {
  const legal = loadLegal();
  const page = legal[id];
  const otherId: LegalDocId = id === "terms" ? "privacy" : "terms";
  const other = legal[otherId];
  const line = (text: string) => `<p>${linkify(text === CONTACT_TOKEN ? legal.contact : text)}</p>`;

  const sections = page.sections
    .map((section) => {
      const parts = [
        ...(section.paragraphs ?? []).map(line),
        section.items?.length
          ? `<ul>${section.items.map((item) => `<li>${linkify(item)}</li>`).join("")}</ul>`
          : "",
        ...(section.after ?? []).map(line),
      ];
      return `<section><h2>${escapeHtml(section.heading)}</h2>${parts.join("")}</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)} — Моти</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #10131a; color: #f4f6fb; }
    main { width: min(560px, 100%); margin: 0 auto; padding: 20px 16px 32px; display: grid; gap: 14px; box-sizing: border-box; }
    h1 { margin: 0; font-size: 1.35rem; }
    h2 { margin: 0 0 8px; font-size: 1.05rem; }
    p, li { margin: 0 0 8px; color: #c3cbdb; line-height: 1.45; }
    ul { margin: 0 0 8px; padding-left: 20px; }
    p:last-child { margin-bottom: 0; }
    a { color: #8ab4ff; word-break: break-word; }
    .updated { font-size: 13px; color: #93a0b8; }
    .intro { background: #1b2130; border-radius: 14px; padding: 12px 14px; color: #f4f6fb; }
    section { background: #1b2130; border-radius: 18px; padding: 16px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(page.title)}</h1>
    <p class="updated">Редакция от ${escapeHtml(legal.updated)}</p>
    <p class="intro">${linkify(page.intro)}</p>
    ${sections}
    <nav aria-label="Документы и поддержка">
      <a href="/${otherId}">${escapeHtml(other.title)}</a>
      <a href="https://t.me/${config.botUsername}?start=support" target="_blank" rel="noreferrer">Написать в поддержку</a>
    </nav>
  </main>
</body>
</html>`;
}
