export function KnowButton({
  known,
  disabled,
  onClick,
}: {
  known: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`know-btn${known ? " known" : ""}`}
      aria-pressed={known}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="know-btn-mark" aria-hidden="true">
        {known ? (
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path
              d="M3.2 8.2 6.4 11.3 12.8 4.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      Знаю
    </button>
  );
}
