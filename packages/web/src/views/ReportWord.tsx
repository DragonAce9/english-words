import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reportWord, visibleError } from "../api";
import { targetWord } from "../word";

const REASONS = [
  { id: "translation", label: "Перевод" },
  { id: "category", label: "Категория" },
  { id: "sense", label: "Значение" },
  { id: "example", label: "Пример" },
] as const;

const REPORT_SENT = "Жалоба отправлена в поддержку";
const REPORT_FAILED = "Не удалось отправить жалобу в поддержку. Попробуйте ещё раз.";

function visibleReportError(err: unknown): string {
  return visibleError(err, REPORT_FAILED);
}

export function ReportWord({
  word,
  themeId,
}: {
  word: { id: string; en: string; word?: string };
  themeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]["id"]>("translation");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const host = rootRef.current?.closest(".word-row");
    setPanelHost(host instanceof HTMLElement ? host : null);
  }, []);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await reportWord({ wordId: word.id, themeId, reason, comment });
      setSent(true);
    } catch (err) {
      setSent(false);
      setError(visibleReportError(err));
    } finally {
      setBusy(false);
    }
  }

  const panel = open ? (
    <div className="report-panel">
      {sent ? (
        <p className="report-done" role="status">
          {REPORT_SENT}
        </p>
      ) : (
        <>
          <div className="report-reasons">
            {REASONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === reason ? "report-reason on" : "report-reason"}
                onClick={() => setReason(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <input
            className="report-comment"
            value={comment}
            maxLength={300}
            placeholder="Комментарий, если нужно"
            onChange={(event) => setComment(event.target.value)}
          />
          <button type="button" className="report-send" disabled={busy} onClick={() => void submit()}>
            {busy ? "Отправляю…" : `Отправить · ${targetWord(word)}`}
          </button>
          {error ? (
            <p className="report-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="report-word" ref={rootRef}>
      <button
        type="button"
        className={`report-open${open ? " on" : ""}${sent ? " sent" : ""}`}
        aria-label={sent ? REPORT_SENT : "Пожаловаться на перевод"}
        aria-expanded={sent ? undefined : open}
        disabled={sent}
        onClick={() => setOpen((value) => !value)}
      >
        {sent ? <CheckIcon /> : <FlagIcon />}
      </button>
      {panelHost ? (panel ? createPortal(panel, panelHost) : null) : panel}
    </div>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M6 3.5v17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6 4.5h12.2L15.6 8.4l2.6 3.9H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M5 12.5 10 17.5 19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
