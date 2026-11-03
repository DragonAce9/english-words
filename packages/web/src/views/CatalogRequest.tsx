import { useState } from "react";
import { requestCatalogTitle, visibleError } from "../api";

type CatalogKind = "movie" | "series";

export function CatalogRequest() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CatalogKind>("movie");
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const nextTitle = title.trim();
    if (!nextTitle || busy) return;
    setBusy(true);
    setError("");
    setSent(false);
    try {
      await requestCatalogTitle({ kind, title: nextTitle, comment: comment.trim() });
      setTitle("");
      setComment("");
      setOpen(false);
      setSent(true);
    } catch (err) {
      setError(visibleError(err, "Не удалось отправить заявку. Попробуйте ещё раз."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="catalog-request">
      <button
        type="button"
        className="ghost catalog-request-open"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Попросить фильм или сериал
      </button>
      {open ? (
        <form
          className="catalog-request-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="catalog-view" role="group" aria-label="Тип">
            <button
              type="button"
              className="catalog-view-option"
              aria-pressed={kind === "movie"}
              disabled={busy}
              onClick={() => setKind("movie")}
            >
              фильм
            </button>
            <button
              type="button"
              className="catalog-view-option"
              aria-pressed={kind === "series"}
              disabled={busy}
              onClick={() => setKind("series")}
            >
              сериал
            </button>
          </div>
          <input
            className="input"
            value={title}
            maxLength={200}
            placeholder="Название"
            aria-label="Название"
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className="input"
            value={comment}
            maxLength={300}
            placeholder="Комментарий, если нужно"
            aria-label="Комментарий"
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
          />
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            Отправить заявку
          </button>
          {error ? <p className="feedback bad">{error}</p> : null}
        </form>
      ) : null}
      {sent ? (
        <p className="feedback ok" role="status">
          Заявка отправлена
        </p>
      ) : null}
    </div>
  );
}
