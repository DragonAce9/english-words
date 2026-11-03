/** Speaker button rate. */
export const NORMAL_SPEECH_RATE = 1;

/** Turtle button rate. */
export const SLOW_SPEECH_RATE = 0.25;

export type SpeakActive = { phrase: string; rate: number } | null;

type Listener = (active: SpeakActive) => void;

const listeners = new Set<Listener>();
let generation = 0;

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function subscribeSpeak(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(active: SpeakActive): void {
  for (const listener of listeners) listener(active);
}

const NOVELTY =
  /bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|zarvox|wobble|fred|albert|ralph|junior|kathy|princess|grandma|grandpa|rocko|\beddy\b|\bflo\b|\breed\b|\bsandy\b|\bshelley\b|плохие новости|бах|колокольчик|прыг-скок|пузырьки|виолончель|хорошие новости|шутник|орган|суперзвезда|триноид|шепот|зарвокс|воббл|фред|альберт|ральф|джуниор|кэти|бабушк|дедушк|роко/i;

const NEWER = [
  "samantha",
  "саманта",
  "ava",
  "ава",
  "allison",
  "эллисон",
  "nicky",
  "никки",
  "susan",
  "karen",
  "карен",
  "moira",
  "мойра",
];

function voiceScore(voice: { name: string; lang: string }, lang: string): number {
  const name = voice.name.toLowerCase();
  if (NOVELTY.test(name)) return -100;
  let score = 10;
  if (name.includes("google")) score += 50;
  if (/premium|enhanced|siri|neural|премиум|улучшен/.test(name)) score += 40;
  if (prefersVoice(voice, lang)) score += 200;
  if (normalizeLang(voice.lang) === normalizeLang(lang)) score += 20;
  if (languagePrefix(lang) === "en") {
    const newer = NEWER.findIndex((item) => name.includes(item));
    if (newer >= 0) score += 30 - newer;
    if (voice.lang === "en-US") score += 10;
    else if (normalizeLang(voice.lang).startsWith("en-gb")) score += 6;
  }
  return score;
}

let voiceLang = "en-US";

export function setVoiceLang(lang: string): void {
  voiceLang = lang || "en-US";
}

export function currentVoiceLang(): string {
  return voiceLang;
}

/**
 * The user's own choice of system voice, one per study language, kept on this device.
 * Voices differ between phones, so the choice is not sent to the server.
 */
const VOICE_CHOICE_PREFIX = "moti.voice.";

function voiceChoiceKey(lang: string): string {
  return `${VOICE_CHOICE_PREFIX}${languagePrefix(lang)}`;
}

export function chosenVoiceURI(lang: string): string | null {
  try {
    return window.localStorage.getItem(voiceChoiceKey(lang));
  } catch {
    return null;
  }
}

/** `null` returns the language to automatic voice selection. */
export function chooseVoice(lang: string, voiceURI: string | null): void {
  try {
    if (voiceURI) window.localStorage.setItem(voiceChoiceKey(lang), voiceURI);
    else window.localStorage.removeItem(voiceChoiceKey(lang));
  } catch {
    // Private mode without storage: the pick lasts until the page closes.
  }
  emitVoiceChange();
}

const voiceListeners = new Set<() => void>();

export function subscribeVoiceChange(listener: () => void): () => void {
  voiceListeners.add(listener);
  return () => voiceListeners.delete(listener);
}

function emitVoiceChange(): void {
  for (const listener of voiceListeners) listener();
}

/** Installed voices that can speak this language, normal voices first. */
export function voicesForLanguage<T extends VoiceLike>(voices: readonly T[], lang: string): T[] {
  return voices
    .filter((voice) => voiceMatchesLanguage(voice, lang))
    .map((voice) => ({ voice, score: voiceScore(voice, lang) }))
    .sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name, "ru"))
    .map((item) => item.voice);
}

/** The user's pick when it is still installed, otherwise the automatic choice. */
export function resolveVoice<T extends VoiceLike & { voiceURI?: string }>(
  voices: readonly T[],
  lang: string,
  chosen: string | null = chosenVoiceURI(lang),
): T | undefined {
  if (chosen) {
    const picked = voices.find((voice) => voice.voiceURI === chosen);
    if (picked) return picked;
  }
  return pickLanguageVoice(voices, lang);
}


export function stopSpeaking(): void {
  generation += 1;
  if (canSpeak()) window.speechSynthesis.cancel();
  emit(null);
}

if (canSpeak()) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    window.speechSynthesis.getVoices();
  });
}

/** How long to wait for iOS to publish speechSynthesis voices. */
const VOICE_LOAD_TIMEOUT_MS = 500;

type VoiceLike = { name: string; lang: string };

function normalizeLang(lang: string): string {
  return lang.trim().toLowerCase().replaceAll("_", "-");
}

/** Preferred installed voice for a language. Add a name here, not a new code path. */
const PREFERRED_VOICE_NAMES: Record<string, readonly string[]> = {
  fr: ["thomas"],
};

export function languagePrefix(lang: string): string {
  return normalizeLang(lang).split("-")[0] || "en";
}

export function voiceMatchesLanguage(voice: VoiceLike, lang: string): boolean {
  const code = normalizeLang(voice.lang);
  const prefix = languagePrefix(lang);
  return code === prefix || code.startsWith(`${prefix}-`);
}

function prefersVoice(voice: VoiceLike, lang: string): boolean {
  const names = PREFERRED_VOICE_NAMES[languagePrefix(lang)] ?? [];
  const folded = voice.name.trim().toLowerCase();
  return names.some((name) => folded === name);
}

/**
 * Pick a voice for any study language.
 * A preferred name wins (French: Thomas). Joke voices lose to a normal voice of that language.
 */
export function pickLanguageVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | undefined {
  const inLanguage = voices.filter((voice) => voiceMatchesLanguage(voice, lang));
  const ranked = inLanguage
    .map((voice) => ({ voice, score: voiceScore(voice, lang) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked[0]) return ranked[0].voice;
  const preferred = voices.find((voice) => prefersVoice(voice, lang));
  return preferred ?? inLanguage[0];
}

/** iOS names the French voice the user likes exactly "Thomas" (any case). */
export function isThomasVoiceName(name: string): boolean {
  return name.trim().toLowerCase() === "thomas";
}

/** French speech uses Thomas whenever that voice is installed. */
export function pickFrenchVoice<T extends VoiceLike>(voices: readonly T[], lang = "fr-FR"): T | undefined {
  return pickLanguageVoice(voices, lang);
}

function speakNow(
  synth: SpeechSynthesis,
  phrase: string,
  rate: number,
  lang: string,
  mine: number,
  voices: SpeechSynthesisVoice[],
): void {
  if (generation !== mine) return;
  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.lang = lang || "en-US";
  utterance.rate = rate;
  const voice = resolveVoice(voices, utterance.lang);
  if (voice) utterance.voice = voice;
  const finish = () => {
    if (generation === mine) emit(null);
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  synth.speak(utterance);
  // Telegram iOS (WKWebView) ignores a non-default rate unless the utterance
  // is paused and resumed immediately. Default rate already applies, so the
  // speaker stays on speak + resume and is never left paused.
  if (rate !== NORMAL_SPEECH_RATE) synth.pause();
  synth.resume();
}

/**
 * iOS publishes speech voices on voiceschanged, often after the first tap.
 * Wait until a voice for this language exists. The timeout speaks with whatever
 * is loaded so a missing language pack cannot leave the button stuck.
 */
function ensureVoices(synth: SpeechSynthesis, lang: string): Promise<SpeechSynthesisVoice[]> {
  const ready = () => {
    const voices = synth.getVoices();
    return voices.some((voice) => voiceMatchesLanguage(voice, lang)) ? voices : null;
  };
  const existing = ready();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", onChange);
      resolve(synth.getVoices());
    };
    const onChange = () => {
      if (ready()) finish();
    };
    synth.addEventListener("voiceschanged", onChange);
    window.setTimeout(finish, VOICE_LOAD_TIMEOUT_MS);
  });
}

export function speakWord(text: string, rate = NORMAL_SPEECH_RATE, lang = voiceLang): void {
  const phrase = text.trim();
  if (!phrase || !canSpeak()) return;
  const synth = window.speechSynthesis;
  const mine = ++generation;
  const speakLang = lang || "en-US";
  synth.cancel();
  emit({ phrase, rate });
  void ensureVoices(synth, speakLang).then((loaded) => {
    speakNow(synth, phrase, rate, speakLang, mine, loaded);
  });
}

export function speakEnglish(text: string, rate = NORMAL_SPEECH_RATE): void {
  speakWord(text, rate, voiceLang);
}

/** Resolves with the installed voices once the language has at least one, or after the load timeout. */
export function loadVoices(lang = voiceLang): Promise<SpeechSynthesisVoice[]> {
  if (!canSpeak()) return Promise.resolve([]);
  return ensureVoices(window.speechSynthesis, lang || "en-US");
}

/** Speak a sample with one specific voice so the user can compare voices. */
export function previewVoice(voice: SpeechSynthesisVoice, phrase: string): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  const mine = ++generation;
  synth.cancel();
  emit({ phrase, rate: NORMAL_SPEECH_RATE });
  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.lang = voice.lang;
  utterance.voice = voice;
  utterance.rate = NORMAL_SPEECH_RATE;
  const finish = () => {
    if (generation === mine) emit(null);
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  synth.speak(utterance);
  synth.resume();
}
