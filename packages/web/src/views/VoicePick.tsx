import { useEffect, useState } from "react";
import {
  canSpeak,
  chooseVoice,
  chosenVoiceURI,
  languagePrefix,
  loadVoices,
  pickLanguageVoice,
  previewVoice,
  stopSpeaking,
  subscribeSpeak,
  subscribeVoiceChange,
  voicesForLanguage,
  type SpeakActive,
} from "../speak";
import { ScreenHeader } from "./ScreenHeader";

/** A short phrase in each study language so voices can be compared. */
const SAMPLE: Record<string, string> = {
  en: "Hello! Nice to meet you.",
  fr: "Bonjour ! Enchanté de vous rencontrer.",
  de: "Hallo! Schön, dich kennenzulernen.",
  es: "¡Hola! Encantado de conocerte.",
  it: "Ciao! Piacere di conoscerti.",
  pt: "Olá! Prazer em conhecer você.",
  fi: "Hei! Hauska tavata.",
  sl: "Živjo! Me veseli.",
  hr: "Bok! Drago mi je.",
  sr: "Zdravo! Drago mi je.",
};

export function samplePhrase(lang: string): string {
  return SAMPLE[languagePrefix(lang)] ?? SAMPLE.en;
}

/** Strip the locale suffix Safari appends, e.g. «Eddy (немецкий (Германия))». */
export function voiceLabel(name: string): string {
  return name.replace(/\s*\([^()]*(?:\([^()]*\))?[^()]*\)\s*$/, "").trim() || name;
}

/** Name of the voice that will speak this language right now. */
function useVoiceSummary(lang: string): string {
  const [label, setLabel] = useState("Автоматически");
  useEffect(() => {
    if (!canSpeak()) return;
    let alive = true;
    const update = () => {
      if (!alive) return;
      const chosen = chosenVoiceURI(lang);
      const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === chosen);
      setLabel(chosen && voice ? voiceLabel(voice.name) : "Автоматически");
    };
    update();
    const synth = window.speechSynthesis;
    synth.addEventListener("voiceschanged", update);
    const unsubscribe = subscribeVoiceChange(update);
    return () => {
      alive = false;
      synth.removeEventListener("voiceschanged", update);
      unsubscribe();
    };
  }, [lang]);
  return label;
}

/** Home screen row that opens the voice picker. Hidden when the device cannot speak. */
export function VoiceRow({ lang, onOpen }: { lang: string; onOpen: () => void }) {
  const label = useVoiceSummary(lang);
  if (!canSpeak()) return null;
  return (
    <button type="button" className="language-row" onClick={onOpen}>
      <span>Голос озвучки</span>
      <strong>{label}</strong>
    </button>
  );
}

export function VoicePick({
  lang,
  languageTitle,
  onBack,
}: {
  lang: string;
  languageTitle: string;
  onBack: () => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState<string | null>(() => chosenVoiceURI(lang));
  const [active, setActive] = useState<SpeakActive>(null);
  /** Row whose sample is playing: "auto" or a voiceURI. */
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => subscribeSpeak(setActive), []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void loadVoices(lang).then((list) => {
      if (!alive) return;
      setVoices(voicesForLanguage(list, lang));
      setLoaded(true);
    });
    if (!canSpeak()) return () => {
      alive = false;
    };
    const synth = window.speechSynthesis;
    const refresh = () => {
      if (alive) setVoices(voicesForLanguage(synth.getVoices(), lang));
    };
    synth.addEventListener("voiceschanged", refresh);
    return () => {
      alive = false;
      synth.removeEventListener("voiceschanged", refresh);
      stopSpeaking();
    };
  }, [lang]);

  const automatic = pickLanguageVoice(voices, lang);
  const phrase = samplePhrase(lang);
  const playing = active?.phrase === phrase ? previewing : null;

  function pick(uri: string | null) {
    chooseVoice(lang, uri);
    setChosen(uri);
  }

  function listen(key: string, voice: SpeechSynthesisVoice | undefined) {
    if (!voice) return;
    if (playing === key) {
      stopSpeaking();
      setPreviewing(null);
      return;
    }
    setPreviewing(key);
    previewVoice(voice, phrase);
  }

  return (
    <div className="stack voice-pick">
      <ScreenHeader title="Голос озвучки" onBack={onBack} />
      <p className="word-list-hint">
        {languageTitle}. Список — голоса, установленные на этом устройстве. Новые можно добавить в настройках
        системы. Выбор запоминается здесь, на этом устройстве.
      </p>

      {!canSpeak() ? (
        <p className="word-list-hint">На этом устройстве озвучка недоступна.</p>
      ) : !loaded ? (
        <p className="word-list-hint">Ищем голоса…</p>
      ) : voices.length === 0 ? (
        <p className="word-list-hint">
          Для этого языка нет установленных голосов. Добавь голос в настройках системы и открой экран снова.
        </p>
      ) : (
        <div className="voice-list" role="radiogroup" aria-label="Голос">
          <VoiceOption
            label="Автоматически"
            detail={automatic ? voiceLabel(automatic.name) : "Голос по умолчанию"}
            selected={chosen === null}
            playing={playing === "auto"}
            onSelect={() => pick(null)}
            onListen={() => listen("auto", automatic)}
          />
          {voices.map((voice) => (
            <VoiceOption
              key={voice.voiceURI}
              label={voiceLabel(voice.name)}
              detail={voice.lang}
              selected={chosen === voice.voiceURI}
              playing={playing === voice.voiceURI}
              onSelect={() => pick(voice.voiceURI)}
              onListen={() => listen(voice.voiceURI, voice)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VoiceOption({
  label,
  detail,
  selected,
  playing,
  onSelect,
  onListen,
}: {
  label: string;
  detail: string;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onListen: () => void;
}) {
  return (
    <div className={`voice-row${selected ? " selected" : ""}`}>
      <button type="button" className="voice-row-main" role="radio" aria-checked={selected} onClick={onSelect}>
        <span className="voice-row-mark" aria-hidden="true">
          {selected ? (
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path d="M5 12.5 10 17.5 19 7.5" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <span className="voice-row-text">
          <strong>{label}</strong>
          <span>{detail}</span>
        </span>
      </button>
      <button
        type="button"
        className={`speak-btn${playing ? " on" : ""}`}
        aria-label={`Послушать: ${label}`}
        aria-pressed={playing}
        onClick={onListen}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" />
          <path d="M15.2 9.2a4.2 4.2 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M17.6 6.8a7.2 7.2 0 0 1 0 10.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
