import { beforeAll, describe, expect, it } from "vitest";
import { enterLanguage } from "./catalogContext.js";
import { dictionary, getDictionary } from "./dictionary.js";
import { catalogSenses, localPick, resolveSenses } from "./senses.js";

beforeAll(async () => {
  if (dictionary.words.size === 0) await dictionary.load();
});

describe("sense choice", () => {
  it("keeps one meaning on the original card", () => {
    expect(catalogSenses("airport").map((sense) => sense.id)).toEqual(["airport"]);
  });

  it("reads dance as a verb or a noun from the sentence", async () => {
    const senses = catalogSenses("dance");
    expect(senses.map((sense) => sense.id).sort()).toEqual(["dance", "dance--verbs"]);
    expect(localPick("dance", "They dance every Friday night.", senses).word.id).toBe("dance--verbs");
    expect(localPick("dances", "The dance was long and loud.", senses).word.id).toBe("dance");
    const picks = await resolveSenses([
      { token: "dance", sentence: "They dance every Friday night.", senses },
      { token: "dance", sentence: "The dance was long and loud.", senses },
    ]);
    expect(picks.map((sense) => sense?.id)).toEqual(["dance--verbs", "dance"]);
  });

  it("reads clean as a verb or an adjective from the sentence", () => {
    const senses = catalogSenses("clean");
    expect(localPick("clean", "Please clean the kitchen tonight.", senses).word.id).toBe("clean");
    expect(localPick("clean", "The kitchen is clean.", senses).word.id).toBe("clean--descriptions");
  });

  it("does not attach a catalog card when the sentence uses another meaning", async () => {
    const course = catalogSenses("course");
    const back = catalogSenses("back");
    const picks = await resolveSenses([
      { token: "course", sentence: "Yes, of course.", senses: course },
      { token: "course", sentence: "Course I do, yeah.", senses: course },
      { token: "back", sentence: "I'll be right back.", senses: back },
      { token: "back", sentence: "Just put it back where you found it.", senses: back },
      { token: "back", sentence: "My back hurts today.", senses: back },
    ]);
    expect(picks[0]).toBeUndefined();
    expect(picks[1]).toBeUndefined();
    expect(picks[2]).toBeUndefined();
    expect(picks[3]).toBeUndefined();
    expect(picks[4]?.id).toBe("back");
  });

  it("finds accented and cyrillic headwords in the studied language", async () => {
    const german = getDictionary("de");
    if (german.words.size === 0) await german.load();
    const serbian = getDictionary("sr");
    if (serbian.words.size === 0) await serbian.load();
    expect(enterLanguage("de", () => catalogSenses("fünfzehn").map((sense) => sense.id))).toContain("funfzehn");
    expect(enterLanguage("de", () => catalogSenses("funfzehn").map((sense) => sense.id))).toContain("funfzehn");
    expect(enterLanguage("sr", () => catalogSenses("сасвим").map((sense) => sense.id))).toContain("sasvim");
    expect(enterLanguage("en", () => catalogSenses("airport").map((sense) => sense.id))).toEqual(["airport"]);
    expect(catalogSenses("по крайней мере").map((sense) => sense.id)).not.toContain("word");
    expect(catalogSenses("word").some((sense) => sense.id === "word")).toBe(true);
  });
});
