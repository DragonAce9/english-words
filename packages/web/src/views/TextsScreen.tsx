import { useState } from "react";
import type { TextAnalysis, TextsResponse, ThemeSummary } from "../types";
import { ScreenHeader } from "./ScreenHeader";
import { SwipeDelete } from "./SwipeDelete";

function formatRuDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function TextsScreen({
  data,
  themes,
  busy,
  analyzing,
  enrollBusyId,
  textStudying,
  subscribed,
  onBack,
  onAnalyze,
  onDelete,
  onOpenTheme,
  onLearnText,
  onLearnTheme,
}: {
  data: TextsResponse;
  themes: ThemeSummary[];
  busy?: boolean;
  analyzing?: boolean;
  enrollBusyId?: string | null;
  textStudying?: boolean;
  subscribed?: boolean;
  onBack?: () => void;
  onAnalyze: (texts: { title?: string; body: string }[]) => void;
  onDelete: (id: string) => void;
  onOpenTheme: (theme: ThemeSummary) => void;
  onLearnText: () => void;
  onLearnTheme: (theme: ThemeSummary) => void;
}) {
  const [drafts, setDrafts] = useState<string[]>([""]);
  const analysis = data.analysis;
  const quota = data.quota ?? { maxTexts: subscribed ? 8 : 1, maxChars: subscribed ? 20_000 : 2000, used: data.texts.length };
  const monthlyLimit = quota.monthlyLimit ?? null;
  const monthlyLeft = monthlyLimit === null ? Infinity : Math.max(0, monthlyLimit - (quota.monthlyUsed ?? 0));
  const monthOver = monthlyLimit !== null && monthlyLeft === 0;
  const overQuota = quota.used >= quota.maxTexts || monthOver;
  const tooLong = drafts.some((item) => item.trim().length > quota.maxChars);
  const hasDraftText = drafts.some((item) => item.length > 0);
  const nextDate = quota.nextAt ? formatRuDate(quota.nextAt) : null;

  function clearDraft() {
    setDrafts([""]);
  }

  function submit() {
    const texts = drafts.map((body) => ({ body: body.trim() })).filter((item) => item.body);
    if (texts.length === 0) return;
    onAnalyze(texts);
  }

  return (
    <div className="texts-screen">
      <ScreenHeader title="Тексты" onBack={onBack} />
      <p className="word-list-hint">
        {subscribed
          ? monthlyLimit !== null
            ? `По подписке — ${monthlyLimit} новых текста за ${quota.windowDays ?? 30} дней, до ${quota.maxChars.toLocaleString("ru-RU")} знаков каждый. ${
                monthOver ? "" : `Осталось: ${monthlyLeft}.`
              }`
            : "Вставь статьи или свои заметки. Разберём слова, добавим новые в категории и подскажем, что учить."
          : `Без подписки — 1 свой текст до ${quota.maxChars} знаков. Удали сохранённый, чтобы вставить другой.`}
      </p>

      {drafts.map((value, index) => (
        <label key={index} className="text-draft">
          <span>
            Текст {index + 1}
            <em className={value.trim().length > quota.maxChars ? "text-count-over" : "text-count"}>
              {value.trim().length} / {quota.maxChars}
            </em>
          </span>
          <textarea
            value={value}
            rows={6}
            placeholder="Вставь текст на изучаемом языке…"
            disabled={busy || analyzing || overQuota}
            onChange={(event) =>
              setDrafts((current) => current.map((item, i) => (i === index ? event.target.value : item)))
            }
          />
        </label>
      ))}

      <div className="text-actions">
        <button
          type="button"
          className="ghost"
          disabled={busy || analyzing || !hasDraftText}
          onClick={clearDraft}
        >
          Очистить поле
        </button>
      </div>

      <button
        type="button"
        className="primary"
        disabled={busy || analyzing || overQuota || tooLong || drafts.every((item) => !item.trim())}
        onClick={submit}
      >
        {analyzing ? "Разбираем…" : "Разобрать тексты"}
      </button>
      {analyzing ? (
        <section className="analyze-progress" aria-live="polite">
          <strong>Разбираем текст</strong>
          <p>Можно вернуться на главную — закончим в фоне и покажем, что учить.</p>
          <div className="bar studying-bar analyze-bar" aria-hidden>
            <span />
          </div>
        </section>
      ) : null}
      {monthOver ? (
        <p className="word-list-hint">
          Лимит на этот период исчерпан.{nextDate ? ` Следующий текст можно добавить ${nextDate}.` : ""}
        </p>
      ) : overQuota ? (
        <p className="word-list-hint">
          {subscribed
            ? `Хранить можно до ${quota.maxTexts} текстов. Удали лишние ниже.`
            : "Слот занят. Удали сохранённый текст ниже или оформи подписку."}
        </p>
      ) : null}

      {analysis && !analyzing ? (
        <AnalysisBlock
          analysis={analysis}
          themes={themes}
          enrollBusyId={enrollBusyId}
          textStudying={textStudying}
          onOpenTheme={onOpenTheme}
          onLearnText={onLearnText}
          onLearnTheme={onLearnTheme}
        />
      ) : null}

      {data.texts.length > 0 ? (
        <section className="saved-texts">
          <h2>Сохранённые</h2>
          {data.texts.map((text) => (
            <article key={text.id} className="saved-text card">
              <strong>{text.title}</strong>
              <p>{text.body.slice(0, 160)}{text.body.length > 160 ? "…" : ""}</p>
              <button type="button" className="ghost" disabled={busy || analyzing} onClick={() => onDelete(text.id)}>
                Удалить
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function AnalysisBlock({
  analysis,
  themes,
  enrollBusyId,
  textStudying,
  onOpenTheme,
  onLearnText,
  onLearnTheme,
}: {
  analysis: TextAnalysis;
  themes: ThemeSummary[];
  enrollBusyId?: string | null;
  textStudying?: boolean;
  onOpenTheme: (theme: ThemeSummary) => void;
  onLearnText: () => void;
  onLearnTheme: (theme: ThemeSummary) => void;
}) {
  const byTheme = new Map(themes.map((theme) => [theme.id, theme]));
  const recommendations = analysis.recommendations.filter((item) => {
    const theme = byTheme.get(item.themeId);
    return theme && theme.kind !== "movie" && theme.kind !== "episode";
  });
  const canLearnText = analysis.matched > 0 && !textStudying;
  const textBusy = enrollBusyId === "text";

  return (
    <section className="text-analysis">
      <p className="word-list-lead">
        {analysis.added > 0
          ? `Нашли ${analysis.matched} слов в словаре и добавили ${analysis.added} новых`
          : `Нашли ${analysis.matched} слов в словаре`}
        {analysis.skipped > 0 ? ` · ${analysis.skipped} форм не разобрали` : ""}
      </p>

      <h2>Что учить</h2>
      <p className="word-list-hint">
        «Учить» добавляет карточку текста в «Изучаю». Свайпни категорию вправо — только её. Или открой тему и
        нажми «Учить» внутри.
      </p>
      <button
        type="button"
        className="primary learn-cta"
        disabled={textBusy || !canLearnText}
        onClick={onLearnText}
      >
        {textStudying ? "Учу" : textBusy ? "Добавляем…" : "Учить"}
      </button>
      <div className="recommend-list">
        {recommendations.map((item) => {
          const theme = byTheme.get(item.themeId);
          if (!theme) return null;
          const busy = enrollBusyId === theme.id;
          const card = (
            <button type="button" className="category-card recommend-card" onClick={() => onOpenTheme(theme)}>
              <div className="row">
                <strong>{item.title}</strong>
                <span className="mark">{theme.studying ? "В Изучаю" : `${item.unknown} учить`}</span>
              </div>
              <p className="recommend-meta">
                {item.inText} в тексте · знаешь {item.known}
                {item.added > 0 ? ` · +${item.added} новых` : ""}
              </p>
              {item.sample.length > 0 ? <p className="recommend-sample">{item.sample.join(" · ")}</p> : null}
            </button>
          );
          if (theme.studying) return <div key={item.themeId}>{card}</div>;
          return (
            <SwipeDelete
              key={item.themeId}
              direction="right"
              label="В Изучаю"
              disabled={busy}
              onDelete={() => onLearnTheme(theme)}
            >
              {card}
            </SwipeDelete>
          );
        })}
      </div>

    </section>
  );
}
