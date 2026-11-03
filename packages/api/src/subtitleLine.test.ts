import { describe, expect, it } from "vitest";
import { shortSubtitleLine } from "./subtitleLine.js";

describe("short subtitle line", () => {
  it("keeps one short sentence and an empty example", () => {
    expect(shortSubtitleLine("", "hotel")).toBe("");
    expect(shortSubtitleLine("The hotel is close to the station.", "hotel")).toBe(
      "The hotel is close to the station.",
    );
  });

  it("picks the one sentence that names the word", () => {
    const line = shortSubtitleLine(
      "Someone left. The hotel is close to the station. Then they walked.",
      "hotel",
    );
    expect(line).toBe("The hotel is close to the station.");
  });

  it("does not return a whole subtitle file when a short sentence exists", () => {
    const dump = `The hotel is close.\n${"later ".repeat(80)}end of file.`;
    const line = shortSubtitleLine(dump, "hotel");
    expect(line).toBe("The hotel is close.");
    expect(line.length).toBeLessThanOrEqual(140);
    expect(line).not.toContain("end of file");
  });

  it("clips one long sentence instead of keeping the quote", () => {
    const quote = `The hotel ${"really ".repeat(40)}matters.`;
    const line = shortSubtitleLine(quote, "hotel");
    expect(line.endsWith("…")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(140);
    expect(line.length).toBeLessThan(quote.length);
  });
});
