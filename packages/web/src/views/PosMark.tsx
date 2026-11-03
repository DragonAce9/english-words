import { posLabel } from "../pos";

const GENDER_LABEL: Record<string, string> = { m: "м", f: "ж", n: "ср", "m/f": "м/ж" };

export function PosMark({ pos, gender }: { pos?: string | null; gender?: string | null }) {
  const label = posLabel(pos);
  const genderLabel = gender ? GENDER_LABEL[gender] : undefined;
  const text = [label, genderLabel].filter(Boolean).join(" ");
  if (!text) return null;
  return <span className="pos-mark">{text}</span>;
}
