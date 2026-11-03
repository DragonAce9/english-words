import { useEffect, useState } from "react";
import { track } from "../analytics";
import { openTelegramShare } from "../telegram";
import { ScreenHeader } from "./ScreenHeader";

const SHARE_TEXT =
  "Заходи учить английские слова с Моти. Если пройдёшь первое занятие, я смогу выбрать новую коллекцию.";

export function ReferralExplain({
  inviteUrl,
  source,
  subscribed,
  unspentRewards,
  pendingInvites,
  stepLabel,
  onContinue,
  onPick,
  onBack,
}: {
  inviteUrl: string;
  source: "home" | "first_session";
  subscribed: boolean;
  unspentRewards: number;
  pendingInvites: number;
  stepLabel?: string;
  onContinue?: () => void;
  onPick?: () => void;
  onBack?: () => void;
}) {
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canPick = !subscribed && unspentRewards > 0 && Boolean(onPick);

  useEffect(() => {
    track("referral_explained", { source });
  }, [source]);

  function share() {
    if (!inviteUrl) return;
    if (openTelegramShare(inviteUrl, SHARE_TEXT)) return;
    setShownUrl(inviteUrl);
    const write = navigator.clipboard?.writeText;
    if (!write) return;
    void write.call(navigator.clipboard, inviteUrl).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <>
      {onBack ? <ScreenHeader title="Пригласить друга" onBack={onBack} /> : null}
      <div className="welcome-body">
        {stepLabel ? <p className="welcome-kicker">{stepLabel}</p> : null}
        <h1>Друг заканчивает занятие</h1>
        <p className="welcome-lead">
          Он открывает твою ссылку и доходит до конца первого занятия. Просто открыть — не считается.
        </p>
        <div className="welcome-grid">
          <article className="welcome-point">
            <strong>Одна подборка</strong>
            <span>Закрытый фильм, целый сериал или тема. 10 бесплатных тем и один фильм или сериал остаются.</span>
          </article>
          <article className="welcome-point">
            <strong>Маша</strong>
            <span>Открывает ссылку и заканчивает занятие. Ты берёшь Arcane или тему «Готовка».</span>
          </article>
        </div>
        {subscribed ? (
          <p className="referral-lead">
            У тебя уже всё открыто. Ссылку можно отправить, выбирать не нужно.
          </p>
        ) : null}
        {canPick ? (
          <p className="referral-lead">
            {unspentRewards === 1 ? "Можно выбрать одну подборку." : `Можно выбрать ${unspentRewards}.`}
          </p>
        ) : null}
        {!subscribed && !canPick && pendingInvites > 0 ? (
          <p className="referral-lead">Друг открыл ссылку. Выбор появится, когда он закончит первое занятие.</p>
        ) : null}
      </div>
      <div className="welcome-actions">
        {canPick ? (
          <button type="button" className="primary" onClick={onPick}>
            Выбрать
          </button>
        ) : onContinue ? (
          <button type="button" className="primary" onClick={onContinue}>
            Дальше
          </button>
        ) : (
          <button type="button" className="primary" disabled={!inviteUrl} onClick={share}>
            Пригласить друга
          </button>
        )}
        {canPick || onContinue ? (
          <button type="button" className="ghost" disabled={!inviteUrl} onClick={share}>
            Пригласить друга
          </button>
        ) : null}
        {shownUrl ? (
          <p className="invite-link">
            <a href={shownUrl} target="_blank" rel="noreferrer">
              {shownUrl}
            </a>
          </p>
        ) : null}
        {copied ? <p className="invite-note">Ссылка скопирована</p> : null}
      </div>
    </>
  );
}
