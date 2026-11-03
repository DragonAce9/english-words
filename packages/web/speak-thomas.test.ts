import assert from "node:assert/strict";
import { test } from "node:test";
import { pickFrenchVoice, pickLanguageVoice, resolveVoice, voicesForLanguage } from "./src/speak.ts";

const voices = [
  { name: "Amélie", lang: "fr-FR", voiceURI: "com.apple.voice.compact.fr-FR.Amelie" },
  { name: "Thomas", lang: "fr-FR", voiceURI: "com.apple.voice.compact.fr-FR.Thomas" },
  { name: "Google français", lang: "fr-FR", voiceURI: "Google français" },
];

test("French speech selects Thomas when Amélie and Google français are also installed", () => {
  const picked = pickFrenchVoice(voices, "fr-FR");
  assert.equal(picked?.name, "Thomas");
  assert.equal(picked?.voiceURI, "com.apple.voice.compact.fr-FR.Thomas");
});

test("compact Thomas is kept ahead of a premium voice", () => {
  const picked = pickFrenchVoice(
    [
      { name: "Audrey", lang: "fr-FR", voiceURI: "com.apple.voice.premium.fr-FR.Audrey" },
      { name: "Thomas", lang: "fr-FR", voiceURI: "com.apple.voice.compact.fr-FR.Thomas" },
      { name: "Google français", lang: "fr-FR", voiceURI: "Google français" },
    ],
    "fr-FR",
  );
  assert.equal(picked?.name, "Thomas");
});

test("without Thomas, French uses another French voice and skips a joke voice", () => {
  const picked = pickFrenchVoice(
    [
      { name: "Rocko", lang: "fr-FR" },
      { name: "Amélie", lang: "fr-FR" },
      { name: "Google français", lang: "fr-FR" },
    ],
    "fr-FR",
  );
  assert.equal(picked?.name, "Google français");
});

test("Thomas matches case-insensitively", () => {
  const picked = pickFrenchVoice([{ name: "THOMAS", lang: "fr-FR" }], "fr-FR");
  assert.equal(picked?.name, "THOMAS");
});

test("German speech uses a German voice and ignores English and joke voices", () => {
  const picked = pickLanguageVoice(
    [
      { name: "Samantha", lang: "en-US" },
      { name: "Eddy (немецкий (Германия))", lang: "de-DE" },
      { name: "Grandma (немецкий (Германия))", lang: "de-DE" },
      { name: "Helena", lang: "de-DE" },
      { name: "Анна", lang: "de-DE" },
    ],
    "de-DE",
  );
  assert.equal(picked?.name, "Helena");
  assert.equal(picked?.lang, "de-DE");
});

test("exact locale wins over another voice of the same language", () => {
  const picked = pickLanguageVoice(
    [
      { name: "Petra", lang: "de-AT" },
      { name: "Anna", lang: "de-DE" },
    ],
    "de-DE",
  );
  assert.equal(picked?.name, "Anna");
});

test("the user's chosen voice beats the automatic pick", () => {
  const picked = resolveVoice(voices, "fr-FR", "com.apple.voice.compact.fr-FR.Amelie");
  assert.equal(picked?.name, "Amélie");
});

test("a chosen voice that is no longer installed falls back to the automatic pick", () => {
  const picked = resolveVoice(voices, "fr-FR", "com.apple.voice.premium.fr-FR.Audrey");
  assert.equal(picked?.name, "Thomas");
});

test("without a choice the automatic pick is used", () => {
  assert.equal(resolveVoice(voices, "fr-FR", null)?.name, "Thomas");
});

test("the voice list for a language keeps only its voices, normal ones first", () => {
  const list = voicesForLanguage(
    [
      { name: "Samantha", lang: "en-US" },
      { name: "Grandma (немецкий (Германия))", lang: "de-DE" },
      { name: "Helena", lang: "de-DE" },
      { name: "Petra", lang: "de-AT" },
    ],
    "de-DE",
  );
  assert.deepEqual(
    list.map((voice) => voice.name),
    ["Helena", "Petra", "Grandma (немецкий (Германия))"],
  );
});

test("a language without a preferred name still picks its own voice", () => {
  const picked = pickLanguageVoice(
    [
      { name: "Samantha", lang: "en-US" },
      { name: "Mónica", lang: "es-ES" },
    ],
    "es-ES",
  );
  assert.equal(picked?.name, "Mónica");
});
