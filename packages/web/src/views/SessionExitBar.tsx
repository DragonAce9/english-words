import { useState, type ReactNode } from "react";

export function SessionExitBar({
  children,
  extra,
  flush,
  onDone,
  disabled,
}: {
  children?: ReactNode;
  extra?: ReactNode;
  flush?: (keepalive?: boolean) => Promise<void>;
  onDone: () => void;
  disabled?: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  const busy = Boolean(disabled || leaving);

  return (
    <div className="session-top">
      <div className="session-top-row">
        <div className="session-top-info">{children}</div>
        <button
          type="button"
          className="exit"
          disabled={busy}
          aria-label="Выйти"
          onClick={async () => {
            if (busy) return;
            setLeaving(true);
            try {
              await flush?.();
              onDone();
            } catch {
              setLeaving(false);
            }
          }}
        >
          Выйти
        </button>
      </div>
      {extra}
    </div>
  );
}
