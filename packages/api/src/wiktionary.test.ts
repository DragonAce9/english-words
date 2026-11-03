import { describe, expect, it } from "vitest";
import { buildWiktionaryIndex, foldWikiKey, searchWiktionaryIndex, slugHead } from "./wiktionary.js";

describe("wiktionary index", () => {
  const index = buildWiktionaryIndex(
    ["mouse\tmouse\tn\t\tмышь|мышка\tThe mouse ran.\n", "haus\tHaus\tn\tm\tдом\tDas Haus ist alt."],
    ["mice\tmouse"],
  );

  it("folds accents and German ß the same way as the import", () => {
    expect(foldWikiKey("École")).toBe("ecole");
    expect(foldWikiKey("Straße")).toBe("strasse");
    expect(slugHead("aéroport")).toBe("aeroport");
    expect(slugHead("Flughafen")).toBe("flughafen");
  });

  it("resolves a headword and an inflected form to one card", () => {
    expect(searchWiktionaryIndex(index, "mouse")?.ru).toEqual(["мышь", "мышка"]);
    expect(searchWiktionaryIndex(index, "mice")?.word).toBe("mouse");
    expect(searchWiktionaryIndex(index, "haus")?.gender).toBe("m");
    expect(searchWiktionaryIndex(index, "Häuser")).toBeNull();
  });
});
