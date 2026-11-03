import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  CATEGORY_WORD_LIMIT,
  classifyInterest,
  INTEREST_OTHER_ID,
  INTEREST_OTHER_TITLE,
  INTERESTS,
} from "../packages/api/src/interests.js";
import type { CefrLevel, DictWord } from "../packages/api/src/types.js";
import { CEFR_LEVELS } from "../packages/api/src/types.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const language = "en";
const themesDir = join(root, "data", language, "themes");
const blocksPath = join(root, "data", language, "blocks.json");
const posPath = join(root, "data", language, "word-pos.json");

interface ThemeFile {
  id: string;
  title: string;
  paid: boolean;
  words: DictWord[];
  blockId: string;
}

interface BlockFile {
  id: string;
  title: string;
  order: number;
  themeIds: string[];
}

interface CatalogRow {
  word_id: string;
  theme_id: string;
  en: string;
  ru: string[];
  example: string;
  level: string;
}

function asWord(row: CatalogRow): DictWord {
  const level = (CEFR_LEVELS as string[]).includes(row.level) ? (row.level as CefrLevel) : "B1";
  return {
    id: row.word_id,
    en: row.en,
    ru: row.ru ?? [],
    example: row.example ?? "",
    level,
  };
}

function writeTheme(theme: ThemeFile): Promise<void> {
  const body = {
    id: theme.id,
    title: theme.title,
    paid: theme.paid,
    words: theme.words,
    blockId: theme.blockId,
  };
  return writeFile(join(themesDir, `${theme.id}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

function splitDescriptions(words: DictWord[]): ThemeFile[] {
  const byLevel = new Map<CefrLevel, DictWord[]>();
  for (const word of words) {
    const list = byLevel.get(word.level) ?? [];
    list.push(word);
    byLevel.set(word.level, list);
  }
  const out: ThemeFile[] = [];
  for (const level of CEFR_LEVELS) {
    const slice = byLevel.get(level) ?? [];
    if (slice.length === 0) continue;
    if (slice.length <= 700) {
      out.push({
        id: `descriptions-${level.toLowerCase()}`,
        title: `Уровень ${level}`,
        paid: true,
        blockId: "descriptions",
        words: slice,
      });
      continue;
    }
    const sorted = [...slice].sort((a, b) => a.en.localeCompare(b.en, "en"));
    const mid = Math.ceil(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    const leftTo = (left[left.length - 1]?.en[0] ?? "m").toUpperCase();
    const rightFrom = (right[0]?.en[0] ?? "n").toUpperCase();
    out.push(
      {
        id: `descriptions-${level.toLowerCase()}-a`,
        title: `Уровень ${level}, A–${leftTo}`,
        paid: true,
        blockId: "descriptions",
        words: left,
      },
      {
        id: `descriptions-${level.toLowerCase()}-b`,
        title: `Уровень ${level}, ${rightFrom}–Z`,
        paid: true,
        blockId: "descriptions",
        words: right,
      },
    );
  }
  return out;
}

async function main() {
  const sql = postgres("postgres://english:english@127.0.0.1:5433/english", { max: 1 });
  const themes = new Map<string, ThemeFile>();
  for (const file of (await readdir(themesDir)).filter((name) => name.endsWith(".json"))) {
    const parsed = JSON.parse(await readFile(join(themesDir, file), "utf8")) as ThemeFile;
    themes.set(parsed.id, parsed);
  }
  const known = new Set<string>();
  for (const theme of themes.values()) for (const word of theme.words) known.add(word.id);

  const rows = await sql<CatalogRow[]>`
    SELECT word_id, theme_id, en, ru, example, level FROM catalog_words
  `;
  const themeMoves = new Map<string, string>();
  const interestCounts = new Map<string, number>();
  let newlyCategorized = 0;
  let movedOffGeneral = 0;

  for (const row of rows) {
    if (known.has(row.word_id)) continue;
    const word = asWord(row);
    let themeId = row.theme_id;
    if (themeId === "general" || !themes.has(themeId)) {
      const match = classifyInterest(word.en, word.ru);
      themeId = match ? `interest-${match.categoryId}` : INTEREST_OTHER_ID;
      if (row.theme_id === "general") movedOffGeneral += 1;
    }
    const theme = themes.get(themeId);
    if (theme) {
      if (!theme.words.some((item) => item.id === word.id)) theme.words.push(word);
    } else if (themeId.startsWith("interest-")) {
      const category = INTERESTS.find((item) => `interest-${item.id}` === themeId);
      themes.set(themeId, {
        id: themeId,
        title: category?.nameRu ?? INTEREST_OTHER_TITLE,
        paid: true,
        blockId: "interests",
        words: [word],
      });
    } else {
      throw new Error(`no theme file for ${themeId} (${word.id})`);
    }
    known.add(word.id);
    newlyCategorized += 1;
    if (themeId !== row.theme_id) themeMoves.set(word.id, themeId);
    if (themeId.startsWith("interest-")) interestCounts.set(themeId, (interestCounts.get(themeId) ?? 0) + 1);
  }

  const descriptions = themes.get("descriptions");
  const descriptionParts: ThemeFile[] = [];
  const descriptionHome = new Map<string, string>();
  if (descriptions && descriptions.words.length > CATEGORY_WORD_LIMIT) {
    descriptionParts.push(...splitDescriptions(descriptions.words));
    for (const part of descriptionParts) {
      for (const word of part.words) descriptionHome.set(word.id, part.id);
      themes.set(part.id, part);
    }
    themes.delete("descriptions");
    for (const [wordId, themeId] of descriptionHome) {
      const row = rows.find((item) => item.word_id === wordId);
      if (row && row.theme_id !== themeId) themeMoves.set(wordId, themeId);
    }
  }

  const oversized = [...themes.values()].filter((theme) => theme.words.length > CATEGORY_WORD_LIMIT);
  if (oversized.length > 0) {
    throw new Error(`still over ${CATEGORY_WORD_LIMIT}: ${oversized.map((theme) => `${theme.id}:${theme.words.length}`).join(", ")}`);
  }

  for (const theme of themes.values()) {
    if (theme.id.startsWith("interest-") || theme.id.startsWith("descriptions-")) await writeTheme(theme);
  }
  for (const theme of themes.values()) {
    if (theme.id.startsWith("interest-") || theme.id.startsWith("descriptions-")) continue;
    const touched = rows.some((row) => row.theme_id === theme.id && !themeMoves.has(row.word_id));
    if (touched) await writeTheme(theme);
  }
  if (descriptionParts.length > 0) {
    await unlink(join(themesDir, "descriptions.json")).catch(() => undefined);
  }

  const blocks = JSON.parse(await readFile(blocksPath, "utf8")) as BlockFile[];
  const language = blocks.find((block) => block.id === "language");
  if (language) language.themeIds = language.themeIds.filter((id) => id !== "descriptions");
  const kept = blocks.filter((block) => block.id !== "descriptions" && block.id !== "interests");
  const other = kept.find((block) => block.id === "other");
  if (other) other.order = 9;
  const descriptionIds = descriptionParts.length > 0
    ? descriptionParts.map((theme) => theme.id)
    : [...themes.keys()].filter((id) => id.startsWith("descriptions-")).sort();
  if (descriptionIds.length > 0) {
    kept.push({
      id: "descriptions",
      title: "Описание",
      order: 6,
      themeIds: descriptionIds,
    });
  }
  const interestIds = [
    ...INTERESTS.map((category) => `interest-${category.id}`),
    INTEREST_OTHER_ID,
  ].filter((id) => themes.has(id));
  kept.push({ id: "interests", title: "Интересы", order: 7, themeIds: interestIds });
  kept.sort((a, b) => a.order - b.order);
  await writeFile(blocksPath, `${JSON.stringify(kept, null, 2)}\n`);

  if (descriptionHome.size > 0) {
    const pos = JSON.parse(await readFile(posPath, "utf8")) as Record<string, string>;
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(pos)) {
      const tab = key.indexOf("\t");
      const themeId = tab === -1 ? "" : key.slice(0, tab);
      const wordId = tab === -1 ? key : key.slice(tab + 1);
      if (themeId === "descriptions" && descriptionHome.has(wordId)) {
        next[`${descriptionHome.get(wordId)}\t${wordId}`] = value;
      } else next[key] = value;
    }
    await writeFile(posPath, `${JSON.stringify(next)}\n`);
  }

  const moves = [...themeMoves.entries()];
  await sql.begin(async (tx) => {
    for (const [wordId, themeId] of moves) {
      await tx`UPDATE catalog_words SET theme_id = ${themeId} WHERE word_id = ${wordId}`;
      await tx`
        DELETE FROM user_words AS old
        USING user_words AS keep
        WHERE old.word_id = ${wordId}
          AND old.theme_id IN ('general', 'descriptions')
          AND keep.user_id = old.user_id
          AND keep.word_id = old.word_id
          AND keep.theme_id = ${themeId}
      `;
      await tx`
        UPDATE user_words
        SET theme_id = ${themeId}
        WHERE word_id = ${wordId} AND theme_id IN ('general', 'descriptions')
      `;
      await tx`
        UPDATE word_progress
        SET theme_id = ${themeId}
        WHERE word_id = ${wordId} AND theme_id IN ('general', 'descriptions')
      `;
    }
    if (descriptionParts.length > 0) {
      const studiers = await tx<{ user_id: string }[]>`
        SELECT user_id FROM user_studying WHERE theme_id = 'descriptions'
      `;
      for (const row of studiers) {
        for (const part of descriptionParts) {
          await tx`
            INSERT INTO user_studying (user_id, theme_id)
            VALUES (${row.user_id}::bigint, ${part.id})
            ON CONFLICT (user_id, theme_id) DO NOTHING
          `;
        }
      }
      await tx`DELETE FROM user_studying WHERE theme_id = 'descriptions'`;
    }
  });

  const catalogInFiles = rows.filter((row) => known.has(row.word_id)).length;
  console.info(
    JSON.stringify(
      {
        newlyCategorized,
        movedOffGeneral,
        catalogRows: rows.length,
        catalogInFiles,
        descriptions: descriptionParts.map((theme) => [theme.id, theme.title, theme.words.length]),
        interests: [...interestCounts.entries()].sort((a, b) => b[1] - a[1]),
        general: themes.get("general")?.words.length ?? null,
      },
      null,
      2,
    ),
  );
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
