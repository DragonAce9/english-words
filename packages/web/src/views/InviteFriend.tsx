import { useState } from "react";
import { openTelegramShare } from "../telegram";

const SHARE_TEXT = "Заходи учить английские слова с Моти. Если пройдёшь первое занятие, я смогу выбрать новую коллекцию.";

export function InviteFriend({
  inviteUrl,
  pendingInvites,
  unspentRewards,
  subscribed,
  onOpen,
  variant = "card",
}: {
  inviteUrl: string;
  pendingInvites: number;
  unspentRewards: number;
  subscribed: boolean;
  onOpen?: () => void;
  variant?: "card" | "row";
}) {
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canPick = !subscribed && unspentRewards > 0;

  function share() {
    if (openTelegramShare(inviteUrl, SHARE_TEXT)) return;
    setShownUrl(inviteUrl);
    const write = navigator.clipboard?.writeText;
    if (!write) return;
    void write.call(navigator.clipboard, inviteUrl).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  function hint(): string {
    if (subscribed) return "Всё уже открыто. Ссылку можно отправить.";
    if (unspentRewards > 0) return "Можно открыть фильм, сериал или тему, которых ещё нет.";
    if (pendingInvites > 0) return "Ссылку открыли. Выбор — после первого занятия.";
    return "Друг заканчивает первое занятие — ты выбираешь фильм, сериал или тему.";
  }

  const badge = canPick ? (unspentRewards === 1 ? "Выбрать" : `Выбрать · ${unspentRewards}`) : "Коллекция";

  return (
    <div className={variant === "row" ? "invite-friend invite-friend-row" : "invite-friend"}>
      <button
        type="button"
        className={variant === "row" ? "home-link" : "invite-friend-button"}
        onClick={onOpen ?? share}
      >
        {variant === "row" ? (
          <>
            <span className="invite-copy">
              <span>Пригласить друга</span>
              <small>{hint()}</small>
            </span>
            <em>{badge}</em>
          </>
        ) : (
          <>
            <span className="teachers-entry-title">Пригласить друга</span>
            <span className="teachers-entry-hint">
              {hint()}
              {canPick ? ` ${badge}.` : ""}
            </span>
          </>
        )}
      </button>
      {shownUrl ? (
        <p className="invite-link">
          <a href={shownUrl} target="_blank" rel="noreferrer">
            {shownUrl}
          </a>
        </p>
      ) : null}
      {copied ? <p className="invite-note">Ссылка скопирована</p> : null}
    </div>
  );
}
