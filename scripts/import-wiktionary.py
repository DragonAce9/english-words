#!/usr/bin/env python3
"""Build compact Wiktionary indexes. The dumps are streamed, not stored.

English comes from the English Wiktionary translation lists.
The other study languages come from Russian Wiktionary, where the gloss is Russian.

One card per headword. Word forms point at that headword.
Source: English and Russian Wiktionary via Kaikki (CC BY-SA).
Writes data/wiktionary/<lang>.tsv and <lang>.forms.tsv.
"""

from __future__ import annotations

import gzip
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

# English Wiktionary: English headwords with a Russian translation.
URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz"
# Russian Wiktionary: foreign headwords whose gloss is already Russian.
RU_URL = "https://kaikki.org/dictionary/downloads/ru/ru-extract.jsonl.gz"
LANGS = {"en", "fr", "de", "es", "it", "pt", "fi", "sl", "hr", "sr"}
INDEX_LANGS = LANGS | {"sh"}
POS = {
    "noun": "n",
    "verb": "v",
    "adj": "adj",
    "adv": "adv",
    "num": "numeral",
    "pron": "pronoun",
    "det": "determiner",
    "prep": "preposition",
    "conj": "conjunction",
    "intj": "interjection",
}
SKIP_POS = {
    "name",
    "character",
    "symbol",
    "romanization",
    "punct",
    "affix",
    "prefix",
    "suffix",
    "infix",
    "circumfix",
    "interfix",
}
SKIP_FORM_TAGS = {
    "table-tags",
    "inflection-template",
    "class",
    "romanization",
    "hyphenation",
    "pronunciation",
    "audio",
    "error-unknown-tag",
}
FORM_PRIORITY = ("plural", "past", "participle", "comparative", "superlative", "gerund", "diminutive")
MAX_FORMS = 8
CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)
RU_MARK = (b'"code": "ru"', b'"code":"ru"')

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "wiktionary"


def fold(value: str) -> str:
    value = value.lower().replace("ё", "е").replace("ß", "ss").replace("đ", "dj")
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.replace("'", "").replace("’", "")
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def strip_stress(text: str) -> str:
    # Only the stress accent. NFD would also split й into и plus a breve.
    return unicodedata.normalize("NFC", text.translate({0x0300: None, 0x0301: None, 0x0340: None, 0x0341: None}))


def clean_ru(raw: str) -> str:
    text = raw.replace("[[", "").replace("]]", "")
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    text = strip_stress(text)
    text = re.sub(r"\s+\([mfn]\)\s*$", "", text.strip())
    text = text.strip(" .;:")
    if not text or not CYRILLIC.search(text) or len(text) > 40 or re.search(r"\d", text):
        return ""
    if len(text.split()) > 4:
        return ""
    return text


def clean_example(raw: str, head: str) -> str:
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", raw)
    text = text.replace("[[", "").replace("]]", "")
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 8 or len(text) > 100:
        return ""
    if not head or fold(head) not in fold(text):
        return ""
    return text


def gender_of(tags: list[str]) -> str:
    names = set(tags)
    masculine = "masculine" in names
    feminine = "feminine" in names
    neuter = "neuter" in names
    if masculine and feminine:
        return "m/f"
    if masculine:
        return "m"
    if feminine:
        return "f"
    if neuter:
        return "n"
    return ""


def sense_russian(sense: dict) -> list[str]:
    tags = set(sense.get("tags") or [])
    if tags & {"archaic", "obsolete", "misspelling"}:
        return []
    out: list[str] = []
    for item in sense.get("translations") or []:
        if item.get("code") != "ru":
            continue
        if set(item.get("tags") or []) & {"archaic", "obsolete"}:
            continue
        word = clean_ru(str(item.get("word") or ""))
        if word and word not in out:
            out.append(word)
        if len(out) == 3:
            break
    return out


def entry_russian(entry: dict, head: str) -> tuple[list[str], str]:
    for sense in entry.get("senses") or []:
        words = sense_russian(sense)
        if not words:
            continue
        example = ""
        for sample in sense.get("examples") or []:
            example = clean_example(str(sample.get("text") or ""), head)
            if example:
                break
        return words, example
    words: list[str] = []
    for item in entry.get("translations") or []:
        if item.get("code") != "ru":
            continue
        word = clean_ru(str(item.get("word") or ""))
        if word and word not in words:
            words.append(word)
        if len(words) == 3:
            break
    return words, ""


def form_rank(tags: set[str]) -> int:
    for index, name in enumerate(FORM_PRIORITY):
        if name in tags:
            return index
    return len(FORM_PRIORITY)


# Serbian Cyrillic on Russian Wiktionary. The app studies Serbian in Latin.
SR_LOWER = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "ђ": "đ",
    "е": "e",
    "ж": "ž",
    "з": "z",
    "и": "i",
    "ј": "j",
    "к": "k",
    "л": "l",
    "љ": "lj",
    "м": "m",
    "н": "n",
    "њ": "nj",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "ћ": "ć",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "c",
    "ч": "č",
    "џ": "dž",
    "ш": "š",
    "ё": "e",
    "й": "j",
    "ы": "i",
    "э": "e",
    "ю": "ju",
    "я": "ja",
    "ь": "",
    "ъ": "",
}
LABEL_PREFIX = re.compile(r"^(?:[а-яё]{2,12}\.\s*)+", re.IGNORECASE)
LABEL_WORDS = {"сленг", "жарг", "разг", "перен", "устар", "книжн", "спец", "прогр"}
SKIP_GLOSS = re.compile(r"название\s+букв|название\s+перв|^(?:вид|род|форма|один из|разновидность)\b", re.IGNORECASE)
LATIN_LANGS = {"sr", "hr", "sl", "sh"}


def transliterate_sr(text: str) -> str:
    out: list[str] = []
    for ch in text:
        lower = ch.lower()
        mapped = SR_LOWER.get(lower)
        if mapped is None:
            out.append(ch)
            continue
        if ch.isupper() and mapped:
            mapped = mapped[0].upper() + mapped[1:]
        out.append(mapped)
    return "".join(out)


def gloss_pieces(raw: str) -> list[str]:
    text = raw.replace("[[", "").replace("]]", "")
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    text = re.sub(r"\[[^\]]*\]", "", text)
    text = re.sub(r"\([^)]*\)", "", text)
    text = strip_stress(text)
    text = LABEL_PREFIX.sub("", text.strip())
    pieces: list[str] = []
    for part in re.split(r"[,;]|—|–", text):
        words = part.split()
        while words and words[0].lower().strip(".") in LABEL_WORDS:
            words.pop(0)
        piece = clean_ru(" ".join(words))
        if not piece or SKIP_GLOSS.search(piece) or piece.lower().startswith("то же"):
            continue
        if len(CYRILLIC.findall(piece)) < 2:
            continue
        if piece not in pieces:
            pieces.append(piece)
        if len(pieces) == 3:
            break
    return pieces


def gloss_entry(entry: dict, head: str) -> tuple[list[str], str]:
    for sense in entry.get("senses") or []:
        tags = set(sense.get("tags") or [])
        if tags & {"archaic", "obsolete", "misspelling"}:
            continue
        words: list[str] = []
        for gloss in sense.get("glosses") or []:
            for piece in gloss_pieces(str(gloss)):
                if piece not in words:
                    words.append(piece)
                if len(words) == 3:
                    break
            if len(words) == 3:
                break
        if not words:
            continue
        example = ""
        for sample in sense.get("examples") or []:
            example = clean_example(str(sample.get("text") or ""), head)
            if example:
                break
        return words, example
    return [], ""


def display_head(lang: str, head: str) -> str:
    if lang in LATIN_LANGS and CYRILLIC.search(head):
        return transliterate_sr(head)
    if lang == "en":
        return head.lower()
    return head


def form_key_for(lang: str, written: str) -> str:
    if CYRILLIC.search(written):
        if lang not in LATIN_LANGS:
            return ""
        written = transliterate_sr(written)
    return fold(written)


def field(value: str) -> str:
    return value.replace("\t", " ").replace("\n", " ").replace("\r", "")


def open_dump(path: str | None, url: str = URL):
    if path:
        handle = open(path, "rb")
        if path.endswith(".gz"):
            return gzip.GzipFile(fileobj=handle), handle
        return handle, handle
    request = urllib.request.Request(url, headers={"User-Agent": "YourApp/1.0 (educational vocabulary app)"})
    response = urllib.request.urlopen(request, timeout=120)
    return gzip.GzipFile(fileobj=response), response


GLOSS_LANGS = (LANGS - {"en"}) | {"sh"}
GLOSS_MARKS = tuple(f'"lang_code": "{code}"'.encode() for code in GLOSS_LANGS) + tuple(
    f'"lang_code":"{code}"'.encode() for code in GLOSS_LANGS
)


def import_russian_glosses() -> None:
    """Russian Wiktionary glosses for every study language except English."""
    OUT.mkdir(parents=True, exist_ok=True)
    lemmas: dict[str, dict[str, tuple[str, str, str, list[str], str]]] = {lang: {} for lang in GLOSS_LANGS}
    forms: dict[str, dict[str, str]] = {lang: {} for lang in GLOSS_LANGS}
    form_count: dict[tuple[str, str], int] = {}
    stream, raw = open_dump(None, RU_URL)
    seen = 0
    try:
        for line in stream:
            seen += 1
            if seen % 500_000 == 0:
                kept = sum(len(table) for table in lemmas.values())
                print(f"scanned {seen:,} lines, kept {kept:,} headwords", flush=True)
            if not any(mark in line for mark in GLOSS_MARKS):
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            lang = str(entry.get("lang_code") or "")
            if lang not in GLOSS_LANGS:
                continue
            if set(entry.get("tags") or []) & {"archaic", "obsolete", "misspelling"}:
                continue
            pos_name = str(entry.get("pos") or "")
            if pos_name in SKIP_POS:
                continue
            head = str(entry.get("word") or "").strip()
            if not head or len(head) > 48 or "\n" in head or re.search(r"\d", head):
                continue
            display = display_head(lang, head)
            if not display or CYRILLIC.search(display) or re.search(r"\d", display):
                continue
            key = fold(display)
            if not key or len(key) < 2:
                continue
            russian, example = gloss_entry(entry, display)
            if russian and key not in lemmas[lang]:
                lemmas[lang][key] = (display, POS.get(pos_name, ""), gender_of(list(entry.get("tags") or [])), russian, example)
            if key not in lemmas[lang]:
                continue
            ranked: list[tuple[int, str]] = []
            for form in entry.get("forms") or []:
                tags = set(form.get("tags") or [])
                if not tags or tags & SKIP_FORM_TAGS:
                    continue
                written = str(form.get("form") or "").strip()
                form_key = form_key_for(lang, written)
                if not form_key or form_key == key or len(form_key) > 48 or CYRILLIC.search(form_key):
                    continue
                ranked.append((form_rank(tags), form_key))
            ranked.sort()
            for _, written_key in ranked:
                count_key = (lang, key)
                if form_count.get(count_key, 0) >= MAX_FORMS:
                    break
                slot = forms[lang]
                if written_key in slot:
                    continue
                slot[written_key] = key
                form_count[count_key] = form_count.get(count_key, 0) + 1
    finally:
        stream.close()
        raw.close()

    for key, row in lemmas["sh"].items():
        for dest in ("hr", "sr"):
            lemmas[dest].setdefault(key, row)
    for written_key, lemma_key in forms["sh"].items():
        for dest in ("hr", "sr"):
            if lemma_key not in lemmas[dest]:
                continue
            forms[dest].setdefault(written_key, lemma_key)

    for lang in sorted(LANGS - {"en"}):
        table = lemmas[lang]
        lemma_path = OUT / f"{lang}.tsv"
        form_path = OUT / f"{lang}.forms.tsv"
        if not table:
            print(f"{lang}: no Russian glosses")
            continue
        with lemma_path.open("w", encoding="utf-8") as handle:
            for key, (display, pos, gender, russian, example) in sorted(table.items()):
                handle.write(
                    "\t".join([field(key), field(display), pos, gender, field("|".join(russian)), field(example)]) + "\n"
                )
        with form_path.open("w", encoding="utf-8") as handle:
            for written_key, lemma_key in sorted(forms[lang].items()):
                handle.write(f"{field(written_key)}\t{field(lemma_key)}\n")
        print(f"{lang}: {len(table):,} headwords, {len(forms[lang]):,} forms")


def main() -> None:
    source = sys.argv[1] if len(sys.argv) > 1 else None
    OUT.mkdir(parents=True, exist_ok=True)
    lemmas: dict[str, dict[str, tuple[str, str, str, list[str], str]]] = {lang: {} for lang in INDEX_LANGS}
    forms: dict[str, dict[str, str]] = {lang: {} for lang in INDEX_LANGS}
    form_count: dict[tuple[str, str], int] = {}
    stream, raw = open_dump(source)
    seen = 0
    try:
        for line in stream:
            seen += 1
            if seen % 500_000 == 0:
                kept = sum(len(table) for table in lemmas.values())
                print(f"scanned {seen:,} lines, kept {kept:,} headwords", flush=True)
            if not any(mark in line for mark in RU_MARK):
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            lang = str(entry.get("lang_code") or "")
            if lang not in INDEX_LANGS:
                continue
            if set(entry.get("tags") or []) & {"archaic", "obsolete", "misspelling"}:
                continue
            pos_name = str(entry.get("pos") or "")
            if pos_name in SKIP_POS:
                continue
            head = str(entry.get("word") or "").strip()
            if not head or len(head) > 48 or "\n" in head or re.search(r"\d", head):
                continue
            display = head.lower() if lang == "en" else head
            key = fold(display)
            if not key or len(key) < 2:
                continue
            russian, example = entry_russian(entry, display)
            table = lemmas[lang]
            if russian and key not in table:
                tags = list(entry.get("tags") or [])
                table[key] = (display, POS.get(pos_name, ""), gender_of(tags), russian, example)
            if key not in table:
                continue
            ranked: list[tuple[int, str]] = []
            for form in entry.get("forms") or []:
                tags = set(form.get("tags") or [])
                if tags & SKIP_FORM_TAGS:
                    continue
                written = str(form.get("form") or "").strip()
                form_key = fold(written)
                if not form_key or form_key == key or len(form_key) > 48:
                    continue
                ranked.append((form_rank(tags), form_key))
            ranked.sort()
            for _, form_key in ranked:
                count_key = (lang, key)
                if form_count.get(count_key, 0) >= MAX_FORMS:
                    break
                slot = forms[lang]
                if form_key in slot:
                    continue
                slot[form_key] = key
                form_count[count_key] = form_count.get(count_key, 0) + 1
    finally:
        stream.close()
        raw.close()

    for key, row in lemmas["sh"].items():
        if CYRILLIC.search(row[0]):
            continue
        for dest in ("hr", "sr"):
            lemmas[dest].setdefault(key, row)
    for form_key, lemma_key in forms["sh"].items():
        for dest in ("hr", "sr"):
            if lemma_key not in lemmas[dest]:
                continue
            forms[dest].setdefault(form_key, lemma_key)

    for lang, table in sorted(lemmas.items()):
        if lang != "en":
            continue
        lemma_path = OUT / f"{lang}.tsv"
        form_path = OUT / f"{lang}.forms.tsv"
        with lemma_path.open("w", encoding="utf-8") as handle:
            for key, (display, pos, gender, russian, example) in sorted(table.items()):
                handle.write(
                    "\t".join(
                        [
                            field(key),
                            field(display),
                            pos,
                            gender,
                            field("|".join(russian)),
                            field(example),
                        ]
                    )
                    + "\n"
                )
        form_path = OUT / f"{lang}.forms.tsv"
        with form_path.open("w", encoding="utf-8") as handle:
            for form_key, lemma_key in sorted(forms[lang].items()):
                handle.write(f"{field(form_key)}\t{field(lemma_key)}\n")
        print(f"{lang}: {len(table):,} headwords, {len(forms[lang]):,} forms")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--ru":
        import_russian_glosses()
    else:
        main()
