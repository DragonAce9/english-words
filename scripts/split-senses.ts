#!/usr/bin/env npx tsx
/**
 * One-off. Not used by the app.
 *
 * Splits a catalog id into separate cards when its themes carry different
 * meanings. The card the review marked as the right theme keeps the old id,
 * so existing progress stays. A same meaning that the review rejected is
 * removed only when another theme still holds that card.
 *
 *   npx tsx scripts/split-senses.ts /path/to/проверка-каталога.csv
 */
import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const reviewPath = process.argv[2] ?? join(process.env.HOME ?? root, "Desktop", "проверка-каталога.csv");

interface ThemeWord {
  id: string;
  en: string;
  ru: string[];
  example?: string;
  level?: string;
}

interface ThemeFile {
  id: string;
  title: string;
  words: ThemeWord[];
}

interface Listing {
  themeId: string;
  themeTitle: string;
  word: ThemeWord;
}

interface ReviewRow {
  themeOk: boolean;
  translationOk: boolean;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function headword(en: string): string {
  return (en.split(/\s*\/\s*/)[0] ?? en).trim().toLowerCase();
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function glosses(word: ThemeWord): string[] {
  return word.ru.map(norm).filter((item) => item.length >= 3);
}

function sameSense(a: ThemeWord, b: ThemeWord): boolean {
  const left = new Set(glosses(a));
  const right = new Set(glosses(b));
  if (left.size === 0 || right.size === 0) return a.ru.join("|") === b.ru.join("|");
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  const smaller = Math.min(left.size, right.size);
  return shared / smaller > 0.5;
}

function clustersOf(listings: Listing[]): Listing[][] {
  const clusters: Listing[][] = [];
  for (const listing of listings) {
    const cluster = clusters.find((item) => item.some((other) => sameSense(other.word, listing.word)));
    if (cluster) cluster.push(listing);
    else clusters.push([listing]);
  }
  return clusters;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

async function main() {
  const table = parseCsv(readFileSync(reviewPath, "utf8").replace(/^\uFEFF/, ""));
  const header = table[0] ?? [];
  const wordCol = header.indexOf("Слово");
  const themeCol = header.indexOf("Тема");
  const themeOkCol = header.indexOf("Тема верна");
  const translationOkCol = header.indexOf("Перевод верен");
  if (wordCol < 0 || themeCol < 0 || themeOkCol < 0) throw new Error(`Unexpected review header: ${header.join(",")}`);

  const reviews = new Map<string, ReviewRow>();
  for (const cells of table.slice(1)) {
    const word = (cells[wordCol] ?? "").trim().toLowerCase();
    const theme = (cells[themeCol] ?? "").trim();
    if (!word || !theme) continue;
    reviews.set(`${word}\t${theme}`, {
      themeOk: cells[themeOkCol] === "да",
      translationOk: cells[translationOkCol] === "да",
    });
  }

  const blocks = JSON.parse(await readFile(join(root, "data/en/blocks.json"), "utf8")) as { themeIds: string[] }[];
  const themeOrder = new Map<string, number>();
  blocks.flatMap((block) => block.themeIds).forEach((id, index) => themeOrder.set(id, index));

  const themesDir = join(root, "data/en/themes");
  const files = (await readdir(themesDir)).filter((name) => name.endsWith(".json")).sort();
  const loaded = new Map<string, { path: string; theme: ThemeFile; dirty: boolean }>();
  for (const file of files) {
    const theme = JSON.parse(await readFile(join(themesDir, file), "utf8")) as ThemeFile;
    loaded.set(theme.id, { path: join(themesDir, file), theme, dirty: false });
  }

  const byId = new Map<string, Listing[]>();
  const used = new Set<string>();
  for (const item of loaded.values()) {
    for (const word of item.theme.words) {
      used.add(word.id);
      const list = byId.get(word.id) ?? [];
      list.push({ themeId: item.theme.id, themeTitle: item.theme.title, word });
      byId.set(word.id, list);
    }
  }

  function reviewOf(listing: Listing): ReviewRow | undefined {
    return reviews.get(`${headword(listing.word.en)}\t${listing.themeTitle}`);
  }

  function alloc(base: string, themeId: string): string {
    let id = `${base}--${themeId}`;
    let n = 2;
    while (used.has(id)) {
      id = `${base}--${themeId}-${n}`;
      n += 1;
    }
    used.add(id);
    return id;
  }

  const report: string[][] = [];
  let splitWords = 0;
  let newCards = 0;
  let removed = 0;

  for (const [wordId, listings] of byId) {
    if (listings.length < 2) continue;
    const clusters = clustersOf(listings);
    if (clusters.length > 1) {
      const ranked = clusters
        .map((cluster) => {
          const yes = cluster.filter((listing) => reviewOf(listing)?.themeOk === true).length;
          const no = cluster.filter((listing) => reviewOf(listing)?.themeOk === false).length;
          const order = Math.min(...cluster.map((listing) => themeOrder.get(listing.themeId) ?? 999));
          return { cluster, yes, no, order };
        })
        .sort((a, b) => b.cluster.length - a.cluster.length || b.yes - a.yes || a.no - b.no || a.order - b.order);
      splitWords += 1;
      for (const item of ranked.slice(1)) {
        const anchor = [...item.cluster].sort((a, b) => {
          const ay = reviewOf(a)?.themeOk === true ? 0 : 1;
          const by = reviewOf(b)?.themeOk === true ? 0 : 1;
          return ay - by || (themeOrder.get(a.themeId) ?? 999) - (themeOrder.get(b.themeId) ?? 999);
        })[0];
        if (!anchor) continue;
        const nextId = alloc(wordId, anchor.themeId);
        for (const listing of item.cluster) {
          listing.word.id = nextId;
          const bucket = loaded.get(listing.themeId);
          if (bucket) bucket.dirty = true;
          newCards += 1;
          report.push([
            listing.word.en,
            wordId,
            nextId,
            listing.themeTitle,
            listing.word.ru.join("; "),
            "отдельное значение",
          ]);
        }
      }
    }
  }

  const byBase = new Map<string, Listing[]>();
  for (const item of loaded.values()) {
    for (const word of item.theme.words) {
      const base = word.id.split("--")[0] ?? word.id;
      const list = byBase.get(base) ?? [];
      list.push({ themeId: item.theme.id, themeTitle: item.theme.title, word });
      byBase.set(base, list);
    }
  }
  for (const [base, listings] of byBase) {
    if (new Set(listings.map((listing) => listing.word.id)).size < 2) continue;
    const clusters = clustersOf(listings);
    const ranked = clusters
      .map((cluster) => {
        const yes = cluster.filter((listing) => reviewOf(listing)?.themeOk === true).length;
        const no = cluster.filter((listing) => reviewOf(listing)?.themeOk === false).length;
        const order = Math.min(...cluster.map((listing) => themeOrder.get(listing.themeId) ?? 999));
        return { cluster, yes, no, order };
      })
      .sort((a, b) => b.cluster.length - a.cluster.length || b.yes - a.yes || a.no - b.no || a.order - b.order);
    const targets = new Map<Listing, string>();
    ranked.forEach((item, index) => {
      const anchor = [...item.cluster].sort(
        (a, b) => (themeOrder.get(a.themeId) ?? 999) - (themeOrder.get(b.themeId) ?? 999),
      )[0];
      let target = base;
      if (index > 0 && anchor) {
        const preferred = `${base}--${anchor.themeId}`;
        const clusterWords = new Set(item.cluster.map((listing) => listing.word));
        const preferredFree = ![...byBase.values()].some((group) =>
          group.some((listing) => listing.word.id === preferred && !clusterWords.has(listing.word)),
        );
        target = preferredFree ? preferred : alloc(base, anchor.themeId);
      }
      for (const listing of item.cluster) targets.set(listing, target);
    });
    let temp = 0;
    for (const listing of listings) {
      const target = targets.get(listing);
      if (!target || listing.word.id === target) continue;
      listing.word.id = `${base}--reassign-${temp}`;
      temp += 1;
      const bucket = loaded.get(listing.themeId);
      if (bucket) bucket.dirty = true;
    }
    for (const listing of listings) {
      const target = targets.get(listing);
      if (!target || listing.word.id === target) continue;
      listing.word.id = target;
    }
  }

  const after = new Map<string, Listing[]>();
  for (const item of loaded.values()) {
    for (const word of item.theme.words) {
      const list = after.get(word.id) ?? [];
      list.push({ themeId: item.theme.id, themeTitle: item.theme.title, word });
      after.set(word.id, list);
    }
  }

  for (const [wordId, listings] of after) {
    if (listings.length < 2) continue;
    const clusters = clustersOf(listings);
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const kept = cluster.filter((listing) => reviewOf(listing)?.themeOk !== false);
      const rejected = cluster.filter((listing) => reviewOf(listing)?.themeOk === false);
      if (kept.length === 0 || rejected.length === 0) continue;
      for (const listing of rejected) {
        const bucket = loaded.get(listing.themeId);
        if (!bucket) continue;
        bucket.theme.words = bucket.theme.words.filter((word) => word !== listing.word);
        bucket.dirty = true;
        removed += 1;
        report.push([
          listing.word.en,
          wordId,
          "",
          listing.themeTitle,
          listing.word.ru.join("; "),
          "то же значение, тема отклонена разбором",
        ]);
      }
    }
  }

  const keptRemovals = report.filter((line) => line[5] !== "отдельное значение");
  report.length = 0;
  for (const item of loaded.values()) {
    for (const word of item.theme.words) {
      if (!word.id.includes("--")) continue;
      const base = word.id.split("--")[0] ?? word.id;
      report.push([word.en, base, word.id, item.theme.title, word.ru.join("; "), "отдельное значение"]);
    }
  }
  report.push(...keptRemovals);

  const written: string[] = [];
  for (const item of loaded.values()) {
    if (!item.dirty) continue;
    await writeFile(item.path, `${JSON.stringify(item.theme, null, 2)}\n`, "utf8");
    written.push(item.theme.id);
  }

  const out = join(process.env.HOME ?? root, "Desktop", "разделение-значений.csv");
  const body = [["Слово", "Старый id", "Новый id", "Тема", "Перевод", "Что сделано"], ...report]
    .map((line) => line.map(csvCell).join(","))
    .join("\n");
  await writeFile(out, `\uFEFF${body}`, "utf8");

  console.log(
    JSON.stringify(
      {
        reviewRows: reviews.size,
        splitWords: new Set(report.filter((line) => line[5] === "отдельное значение").map((line) => line[1])).size,
        newCards: report.filter((line) => line[5] === "отдельное значение").length,
        removedSameSense: removed,
        files: written.length,
        report: out,
      },
      null,
      2,
    ),
  );
  for (const line of report) console.log(line.join(" | "));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
