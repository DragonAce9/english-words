import { isInsideTelegram } from "../telegram";

/** Screen title. Inside Telegram the «Назад» control is the system one, so ours is not rendered. */
export function ScreenHeader({
  title,
  onBack,
  className,
  backClassName,
}: {
  title: string;
  onBack?: () => void;
  className?: string;
  backClassName?: string;
}) {
  const inside = isInsideTelegram();
  const classes = ["top", inside ? "screen-title screen-title-flow" : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {!inside && onBack ? (
        <button className={["back", backClassName].filter(Boolean).join(" ")} type="button" onClick={onBack}>
          ← Назад
        </button>
      ) : null}
      <h1>{title}</h1>
    </div>
  );
}
