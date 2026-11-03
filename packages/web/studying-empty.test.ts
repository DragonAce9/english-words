import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThemeSummary } from "./src/types.ts";
import type { StudyingScreen as StudyingScreenType } from "./src/views/StudyingScreen.tsx";

const WITH_TEXTS = "Пока здесь пусто. Сюда попадут темы, фильмы и тексты, которые ты начнёшь учить.";
const WITHOUT_TEXTS = "Пока здесь пусто. Сюда попадут темы и фильмы, которые ты начнёшь учить.";

const levels = { A1: 4, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };

const built = await esbuild.build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ["src/views/StudyingScreen.tsx"],
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  write: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
});
const outfile = join(import.meta.dirname, ".studying-empty-bundle.mjs");
writeFileSync(outfile, built.outputFiles[0]!.text);
let StudyingScreen: typeof StudyingScreenType;
try {
  ({ StudyingScreen } = (await import(pathToFileURL(outfile).href)) as {
    StudyingScreen: typeof StudyingScreenType;
  });
} finally {
  unlinkSync(outfile);
}

function theme(patch: Partial<ThemeSummary> & Pick<ThemeSummary, "id" | "title">): ThemeSummary {
  return {
    blockId: "basics",
    wordCount: 4,
    knownCount: 1,
    paid: false,
    locked: false,
    studying: false,
    levels,
    knownByLevel: levels,
    ...patch,
  };
}

function screen(props: Partial<Parameters<typeof StudyingScreen>[0]> = {}) {
  const calls: string[] = [];
  const node = StudyingScreen({
    themes: [],
    onBack: () => undefined,
    onOpen: () => undefined,
    onRemove: () => undefined,
    onOpenFilms: () => calls.push("films"),
    onOpenWords: () => calls.push("words"),
    onOpenTexts: () => calls.push("texts"),
    ...props,
  });
  return { node, calls, html: renderToStaticMarkup(node) };
}

function buttons(node: ReactNode): { label: string; className: string; press: () => void }[] {
  const found: { label: string; className: string; press: () => void }[] = [];
  const visit = (child: ReactNode) => {
    if (child == null || typeof child === "boolean") return;
    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{
      type?: string;
      className?: string;
      children?: ReactNode;
      onClick?: () => void;
    }>;
    if (element.type === "button" && element.props.type === "button" && element.props.onClick) {
      const label = textOf(element.props.children).replace(/\s+/g, " ").trim();
      if (label !== "← Назад") {
        found.push({
          label,
          className: element.props.className ?? "",
          press: element.props.onClick,
        });
      }
    }
    visit(element.props.children);
  };
  visit(node);
  return found;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: ReactNode }).children);
}

test("empty studying list offers films, words, and a custom text", () => {
  const view = screen();
  assert.ok(view.html.includes(WITH_TEXTS));
  assert.doesNotMatch(view.html, /Экзамен|Фильмы и сериалы|из \d+ слов/);
  const actions = buttons(view.node);
  assert.deepEqual(
    actions.map((item) => item.label),
    ["Каталог фильмов", "Каталог слов", "Добавить свой текст"],
  );
  assert.equal(actions[0]?.className, "ghost");
  assert.equal(actions[1]?.className, "primary");
  assert.equal(actions[2]?.className, "ghost");
  actions[0]?.press();
  actions[1]?.press();
  actions[2]?.press();
  assert.deepEqual(view.calls, ["films", "words", "texts"]);
});

test("languages without texts hide the custom-text button", () => {
  const view = screen({ showTexts: false });
  assert.ok(view.html.includes(WITHOUT_TEXTS));
  assert.equal(view.html.includes("Добавить свой текст"), false);
  assert.equal(view.html.includes("тексты"), false);
  const actions = buttons(view.node);
  assert.deepEqual(
    actions.map((item) => item.label),
    ["Каталог фильмов", "Каталог слов"],
  );
  assert.equal(actions[1]?.className, "primary");
});

test("a studying theme keeps the list and hides the empty message", () => {
  const view = screen({
    themes: [theme({ id: "numbers", title: "Числа", studying: true })],
  });
  assert.equal(view.html.includes("Пока здесь пусто"), false);
  assert.equal(view.html.includes("Каталог фильмов"), false);
  assert.equal(view.html.includes("Каталог слов"), false);
  assert.equal(view.html.includes("Добавить свой текст"), false);
  assert.ok(view.html.includes("Числа"));
  assert.ok(view.html.includes("1 из 4 слов"));
  assert.equal(view.html.includes("Экзамен"), false);
  assert.deepEqual(
    buttons(view.node).map((item) => item.label),
    [],
  );
});

test("themes that are not in studying still count as empty", () => {
  const view = screen({
    themes: [theme({ id: "numbers", title: "Числа", studying: false })],
  });
  assert.ok(view.html.includes(WITH_TEXTS));
  assert.equal(view.html.includes("Числа"), false);
});
