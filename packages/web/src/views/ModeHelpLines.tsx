const HEADINGS = new Set(["Как работает:", "Допускаются:"]);

export function ModeHelpLines({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="mode-help-lines">
      {lines.map((line) => (
        <li key={line} className={HEADINGS.has(line) ? "mode-help-heading" : undefined}>
          {line}
        </li>
      ))}
    </ul>
  );
}
