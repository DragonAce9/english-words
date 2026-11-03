import { useEffect, useState } from "react";
import {
  canSpeak,
  NORMAL_SPEECH_RATE,
  SLOW_SPEECH_RATE,
  speakWord,
  stopSpeaking,
  subscribeSpeak,
  type SpeakActive,
} from "../speak";

export function SpeakButton({ text, className }: { text: string; className?: string }) {
  const phrase = text.trim();
  const [active, setActive] = useState<SpeakActive>(null);

  useEffect(() => subscribeSpeak(setActive), []);

  if (!phrase || !canSpeak()) return null;
  const on = active?.phrase === phrase && active.rate === NORMAL_SPEECH_RATE;

  return (
    <button
      type="button"
      className={`speak-btn${on ? " on" : ""}${className ? ` ${className}` : ""}`}
      aria-label={`Произношение: ${phrase}`}
      aria-pressed={on}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (on) stopSpeaking();
        else speakWord(phrase);
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" />
        <path
          d="M15.2 9.2a4.2 4.2 0 0 1 0 5.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M17.6 6.8a7.2 7.2 0 0 1 0 10.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export function SlowSpeakButton({ text, className }: { text: string; className?: string }) {
  const phrase = text.trim();
  const [active, setActive] = useState<SpeakActive>(null);
  const slowRate = SLOW_SPEECH_RATE;

  useEffect(() => subscribeSpeak(setActive), []);

  if (!phrase || !canSpeak()) return null;
  const on = active?.phrase === phrase && active.rate === slowRate;

  return (
    <button
      type="button"
      className={`speak-btn${on ? " on" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Медленно"
      aria-pressed={on}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        speakWord(phrase, slowRate);
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="6.1" r="1.85" fill="currentColor" />
        <ellipse cx="12" cy="13.3" rx="4.7" ry="3.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 10.7v5M9.5 13.3h5M8.1 11.3 5.5 8.9M15.9 11.3 18.5 8.9M8.2 15.5 5.6 18.3M15.8 15.5 18.4 18.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
