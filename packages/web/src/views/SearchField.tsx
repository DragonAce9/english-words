import { useRef, type InputHTMLAttributes } from "react";

type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

export function SearchField({ value, onChange, className, ...rest }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filled = value.length > 0;

  function clear() {
    onChange("");
    inputRef.current?.focus();
  }

  return (
    <div className={`search-field${filled ? " has-value" : ""}`}>
      <input
        {...rest}
        ref={inputRef}
        className={className}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {filled ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Очистить"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            clear();
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
