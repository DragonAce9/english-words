import { useEffect, useMemo, useState } from "react";
import { claimReferralReward, loadReferralRewards, visibleError, type ReferralChoice, type ReferralRewards } from "../api";
import { track } from "../analytics";
import { openTelegramShare } from "../telegram";
import { ScreenHeader } from "./ScreenHeader";

const SHARE_TEXT = "Заходи учить английские слова с Моти. Если пройдёшь первое занятие, я смогу выбрать новую коллекцию.";

function norm(value: string): string {
  return value.trim().toLowerCase().replaceAll("ё", "е");
}

function kindLabel(kind: ReferralChoice["kind"]): string {
  if (kind === "series") return "Сериал";
  if (kind === "movie") return "Фильм";
  return "Тема";
}

export function ReferralPicker({
  inviteUrl,
  onBack,
  onClaimed,
}: {
  inviteUrl: string;
  onBack: () => void;
  onClaimed: () => void;
}) {
  const [data, setData] = useState<ReferralRewards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    void loadReferralRewards()
      .then((next) => {
        if (!gone) setData(next);
      })
      .catch((err: unknown) => {
        if (!gone) setError(visibleError(err, "Не удалось открыть выбор."));
      });
    return () => {
      gone = true;
    };
  }, []);

  const needle = norm(query);
  const media = useMemo(
    () => (data?.media ?? []).filter((item) => !needle || norm(item.title).includes(needle)),
    [data, needle],
  );
  const themes = useMemo(
    () => (data?.themes ?? []).filter((item) => !needle || norm(item.title).includes(needle)),
    [data, needle],
  );
  const selected = [...(data?.media ?? []), ...(data?.themes ?? [])].find((item) => item.id === selectedId) ?? null;

  function share() {
    openTelegramShare(inviteUrl, SHARE_TEXT);
  }

  async function confirm() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await claimReferralReward(selected.id);
      track("referral_reward_claimed", { theme_id: result.themeId, kind: result.kind });
      onClaimed();
    } catch (err) {
      setError(visibleError(err, "Не удалось открыть коллекцию."));
      setBusy(false);
    }
  }

  return (
    <div className="referral-picker">
      <ScreenHeader title="Новая коллекция" onBack={onBack} />
      {error ? <p className="feedback bad">{error}</p> : null}
      {!data ? <p className="referral-lead">Загрузка…</p> : null}
      {data && !data.picker ? (
        <div className="referral-note">
          <p>
            {data.fullAccess
              ? "У тебя уже всё открыто. Выбирать не нужно."
              : "Пока выбирать нечего. Выбор появится, когда друг закончит первое занятие."}
          </p>
          <button className="ghost" type="button" onClick={share}>
            Пригласить друга
          </button>
        </div>
      ) : null}
      {data?.picker ? (
        <>
          <p className="referral-lead">
            Одно приглашение — одна коллекция. 10 бесплатных тем и один фильм или сериал остаются.
            {data.unspentRewards > 1 ? ` Сейчас можно выбрать ${data.unspentRewards}.` : ""}
          </p>
          <input
            className="input"
            value={query}
            placeholder="Найти фильм, сериал или тему"
            onChange={(event) => setQuery(event.target.value)}
          />
          <ChoiceGroup title="Фильмы и сериалы" items={media} selectedId={selectedId} onSelect={setSelectedId} />
          <ChoiceGroup title="Темы слов" items={themes} selectedId={selectedId} onSelect={setSelectedId} />
          {media.length === 0 && themes.length === 0 ? <p className="referral-lead">Ничего не нашлось.</p> : null}
          <div className="sticky-actions">
            <button className="primary" type="button" disabled={!selected || busy} onClick={() => void confirm()}>
              {busy ? "Открываем…" : selected ? `Открыть «${selected.title}»` : "Выбери коллекцию"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ChoiceGroup({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  items: ReferralChoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="referral-group">
      <h2>{title}</h2>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="referral-choice"
          aria-pressed={item.id === selectedId}
          onClick={() => onSelect(item.id)}
        >
          <span>
            <strong>{item.title}</strong>
            <small>
              {kindLabel(item.kind)}
              {item.year ? ` · ${item.year}` : ""}
            </small>
          </span>
        </button>
      ))}
    </section>
  );
}
