export function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${count.toLocaleString("ru-RU")} ${word}`;
}

export function catalogShareLabel(known: number, total: number): string {
  if (total <= 0 || known <= 0) return "0%";
  const percent = Math.round((known / total) * 100);
  if (percent <= 0) return "<1%";
  return `${Math.min(100, percent)}%`;
}
