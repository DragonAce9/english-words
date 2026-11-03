#!/usr/bin/env python3
"""Attach a part of speech to each theme and media listing.

Uses the local FreeDict TEI (data/source/eng-rus/eng-rus.tei) and picks the
sense whose Russian glosses overlap the listing. Writes data/word-pos.json.
"""
import json
import re
import unicodedata
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "data"
tei_path = root / "source" / "eng-rus" / "eng-rus.tei"
OK = {
    "n",
    "v",
    "adj",
    "adv",
    "numeral",
    "pronoun",
    "determiner",
    "preposition",
    "conjunction",
    "interjection",
}
THEME_DEFAULT = {
    "verbs": "v",
    "popular-verbs": "v",
    "irregular-verbs": "v",
    "numbers": "numeral",
}


def norm(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return value.lower().replace("ё", "е").strip()


def score(glosses: list[str], quotes: set[str]) -> int:
    total = 0
    for gloss in glosses:
        cleaned = norm(gloss)
        if not cleaned:
            continue
        if cleaned in quotes:
            total += 3
            continue
        for quote in quotes:
            if len(cleaned) >= 4 and len(quote) >= 4 and (quote.startswith(cleaned) or cleaned.startswith(quote)):
                total += 2
                break
    return total


def main() -> None:
    tei = tei_path.read_text(encoding="utf-8")
    senses: dict[str, dict[str, set[str]]] = {}
    for match in re.finditer(r"<entry>(.*?)</entry>", tei, re.S):
        chunk = match.group(1)
        orth = re.search(r"<orth>([^<]+)</orth>", chunk)
        pos = re.search(r"<pos>([^<]+)</pos>", chunk)
        if not orth or not pos or pos.group(1).strip() not in OK:
            continue
        quotes = {norm(quote) for quote in re.findall(r"<quote>(.*?)</quote>", chunk, re.S)}
        quotes.discard("")
        if quotes:
            senses.setdefault(orth.group(1).strip().lower(), {}).setdefault(pos.group(1).strip(), set()).update(quotes)

    tagged: dict[str, str] = {}
    for folder in ("themes", "media"):
        for path in sorted((root / folder).glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            theme_id = data.get("id") or path.stem
            for word in data.get("words") or []:
                en = str(word.get("en") or "").strip().lower()
                options = senses.get(en) or senses.get(en.split()[0] if en else "") or {}
                best, best_score = None, 0
                for kind, quotes in options.items():
                    got = score(word.get("ru") or [], quotes)
                    if got > best_score:
                        best, best_score = kind, got
                if best_score >= 2:
                    chosen = best
                elif theme_id in THEME_DEFAULT:
                    chosen = THEME_DEFAULT[theme_id]
                elif len(options) == 1:
                    chosen = next(iter(options))
                else:
                    chosen = None
                if chosen:
                    tagged[f"{theme_id}\t{word['id']}"] = chosen

    dest = root / "word-pos.json"
    dest.write_text(json.dumps(tagged, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(tagged)} tags to {dest}")


if __name__ == "__main__":
    main()
