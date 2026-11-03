import { afterAll, describe, expect, it } from "vitest";
import { sql } from "./db.js";
import { knownBeforeDay, knownDay, selectRecallWords } from "./recall.js";
import type { DictWord } from "./types.js";

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const today = "2026-10-26";
const yesterday = "2026-10-25";
const older = "2026-10-01";

function word(id: string): DictWord {
  return { id, en: id, word: id, ru: ["перевод"], example: "", level: "A1" };
}

function known(
  knownOn: string | null,
  control: { passed: boolean; on?: string | null; examPassed?: boolean } = { passed: false },
) {
  return {
    status: "known" as const,
    knownOn,
    controlPassed: control.passed,
    controlPassedOn: control.on ?? null,
    examPassed: control.examPassed ?? false,
  };
}

describe("recall pools", () => {
  it("treats a Postgres date at UTC midnight as that calendar day", () => {
    expect(knownDay(new Date("2026-10-25T00:00:00.000Z"))).toBe(yesterday);
    expect(knownBeforeDay(new Date(`${yesterday}T00:00:00.000Z`), today)).toBe(true);
    expect(knownBeforeDay(new Date(`${today}T00:00:00.000Z`), today)).toBe(false);
    expect(knownBeforeDay(null, today)).toBe(true);
  });

  it("keeps control to words known before today that have not passed, and exam to words that passed control before today", () => {
    const words = [
      word("yesterday"),
      word("today"),
      word("older"),
      word("legacy"),
      word("passed-yesterday"),
      word("passed-today"),
      word("passed-legacy"),
      word("exam-done"),
    ];
    const states = new Map([
      ["yesterday", known(yesterday)],
      ["today", known(today)],
      ["older", known(older)],
      ["legacy", known(null)],
      ["passed-yesterday", known(older, { passed: true, on: yesterday })],
      ["passed-today", known(yesterday, { passed: true, on: today })],
      ["passed-legacy", known(yesterday, { passed: true, on: null })],
      ["exam-done", known(older, { passed: true, on: yesterday, examPassed: true })],
    ]);

    const control = selectRecallWords(words, states, null, today, "control").map((item) => item.id);
    expect(new Set(control)).toEqual(new Set(["yesterday", "older", "legacy"]));
    expect(control).not.toContain("today");
    expect(control).not.toContain("passed-yesterday");
    expect(control).not.toContain("passed-today");
    expect(control).not.toContain("passed-legacy");
    expect(control).not.toContain("exam-done");

    const exam = selectRecallWords(words, states, null, today, "review").map((item) => item.id);
    expect(new Set(exam)).toEqual(new Set(["passed-yesterday", "passed-legacy"]));
    expect(exam).not.toContain("passed-today");
    expect(exam).not.toContain("exam-done");
    expect(exam).not.toContain("yesterday");
  });
});
