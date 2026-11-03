#!/usr/bin/env python3
"""Build hidden Wordtron ranks from fastText crawl vectors.

Reads data/<lang>/ (themes + word-pos.json) and writes only under
data/wordtron/<lang>/. Catalog files are never modified.

This run is meant to be judged before any game UI exists. The script does
not touch the Mini App, the API, or learning flows.

    python scripts/wordtron/build.py --lang en --limit 20

Vectors: the crawl .vec.gz is streamed. Only the first 200_000 rows are kept.
A parsed cache under data/wordtron/.cache/ is reused on the next run.
Guess vocabulary is 30–50k frequent lemmas. Inflected forms collapse to one
lemma so run/runs/running do not take separate neighbor slots.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
import zlib
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT_ROOT = DATA / "wordtron"
CACHE = OUT_ROOT / ".cache"

VECTOR_DIM = 300
MAX_VECTORS = 200_000
VOCAB_SIZE = 40_000
VOCAB_MIN = 30_000
VOCAB_MAX = 50_000
TOP_RANKS = 5_000
LEVELS = ("A1", "A2", "B1", "B2")
CONTENT_POS = ("n", "v", "adj")
LEVEL_RANK = {level: i for i, level in enumerate(LEVELS)}

# Grammatical tokens make poor secret words. They stay in the guess list.
NON_CONTENT = {
    "be", "am", "is", "are", "was", "were", "been", "being",
    "do", "does", "did", "done", "doing",
    "have", "has", "had", "having",
    "get", "got", "gets", "getting",
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "the", "and", "but", "for", "not", "you", "that", "this", "with", "from",
    "they", "she", "his", "her", "its", "our", "who", "what", "there", "their",
    "them", "him", "your", "into", "over", "after", "before", "about", "than",
    "then", "also", "just", "because", "while", "these", "those", "here",
    "when", "where", "which", "how", "some", "any", "other",
}

# Forms that look inflected but are their own lemma.
KEEP_LEMMA = {
    "news", "species", "series", "during", "something", "anything",
    "everything", "nothing", "always", "sometimes", "perhaps", "towards",
    "afterwards", "this", "yes", "bus", "plus", "gas", "lens", "chaos",
    "atlas", "canvas", "alias", "basis", "analysis", "crisis", "tennis",
    "bonus", "virus", "focus", "campus", "chorus", "census", "status",
    "radius", "genius", "leaves", "clothes",
}

# Ablaut and odd plurals the suffix rules cannot see. Suffixes cover the rest.
IRREGULAR = {
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be",
    "been": "be", "being": "be",
    "has": "have", "had": "have",
    "does": "do", "did": "do", "done": "do",
    "went": "go", "gone": "go",
    "said": "say",
    "made": "make",
    "took": "take", "taken": "take",
    "came": "come",
    "seen": "see",
    "got": "get", "gotten": "get",
    "gave": "give", "given": "give",
    "found": "find",
    "told": "tell",
    "felt": "feel",
    "kept": "keep",
    "meant": "mean",
    "met": "meet",
    "paid": "pay",
    "sold": "sell",
    "spent": "spend",
    "sent": "send",
    "built": "build",
    "bought": "buy",
    "brought": "bring",
    "caught": "catch",
    "taught": "teach",
    "sat": "sit",
    "stood": "stand",
    "understood": "understand",
    "won": "win",
    "wrote": "write", "written": "write",
    "ran": "run",
    "ate": "eat", "eaten": "eat",
    "drank": "drink",
    "drove": "drive", "driven": "drive",
    "flew": "fly", "flown": "fly",
    "forgot": "forget", "forgotten": "forget",
    "grew": "grow", "grown": "grow",
    "hid": "hide", "hidden": "hide",
    "knew": "know", "known": "know",
    "lost": "lose",
    "rode": "ride", "ridden": "ride",
    "sang": "sing", "sung": "sing",
    "spoke": "speak", "spoken": "speak",
    "swam": "swim", "swum": "swim",
    "threw": "throw", "thrown": "throw",
    "wore": "wear", "worn": "wear",
    "broke": "break", "broken": "break",
    "chose": "choose", "chosen": "choose",
    "children": "child",
    "men": "man",
    "women": "woman",
    "mice": "mouse",
    "teeth": "tooth",
    "feet": "foot",
    "geese": "goose",
    "better": "good",
    "best": "good",
    "worse": "bad",
    "worst": "bad",
}

# When both stem and stem+e are real words, these bare stems win (doing → do).
PREFER_BARE = {"do", "go", "be", "see"}
VOWELS = set("aeiou")

# fastText crawl splits contractions, so "don't" is mostly the vector for "don".
# Those tokens are not the catalog words they happen to spell.
FRAGMENTS = {
    "don", "dont", "won", "wont", "cant", "aint", "im", "ive", "youre", "theyre",
    "weve", "youve", "theyve", "isn", "isnt", "aren", "arent", "wasn", "wasnt",
    "weren", "werent", "didn", "didnt", "doesn", "doesnt", "hasn", "hasnt",
    "hadn", "hadnt", "haven", "havent", "wouldn", "wouldnt", "couldn", "couldnt",
    "shouldn", "shouldnt", "mustn", "mustnt", "needn", "neednt", "mightn",
    "couldve", "wouldve", "shouldve", "gonna", "wanna", "gotta", "kinda", "sorta",
    "whats", "thats", "heres", "theres", "youll", "theyll", "itll", "thatll",
    "ake",
}

# Concrete catalog words for the English quality sample. They are used only
# when they already pass the same filters as every other target. Other
# languages fall through to a frequency mix until they have their own list.
PROBES = {
    "en": [
        "apple", "dog", "ocean", "knife",
        "eat", "write", "remember", "decide", "arrive",
        "cold", "happy", "expensive", "angry",
        "house", "river", "sleep", "buy", "dark", "beautiful", "quiet",
    ],
}

USER_AGENT = "wordtron-build/1.0 (+local catalog sample; stops after 200k vectors)"


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def vector_url(lang: str) -> str:
    """fastText Common Crawl vectors. One file per language code."""
    return f"https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.{lang}.300.vec.gz"


def list_languages() -> list[str]:
    langs = []
    if not DATA.is_dir():
        return langs
    for path in sorted(DATA.iterdir()):
        if not path.is_dir() or path.name.startswith("."):
            continue
        if path.name == "wordtron" or path.name == "source":
            continue
        if (path / "themes").is_dir():
            langs.append(path.name)
    return langs


def token_pattern(lang: str) -> re.Pattern[str]:
    """Letters only. English allows an apostrophe inside the word, as the catalog does."""
    if lang == "en":
        return re.compile(r"[a-z]+(?:'[a-z]+)?\Z")
    # Other languages: unicode letters, optional internal apostrophe, no digits.
    return re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)?\Z", re.UNICODE)


def token_ok(word: str, pattern: re.Pattern[str]) -> bool:
    if len(word) < 2 or word != word.lower():
        return False
    if "_" in word or "." in word or "/" in word or word.startswith("http"):
        return False
    if any(ch.isdigit() for ch in word):
        return False
    if "'" in word and word.endswith(("'s", "'re", "'ve", "'ll", "'d", "'m")):
        return False
    if word in FRAGMENTS:
        return False
    return pattern.fullmatch(word) is not None


def _stem_is_close(stem_i: int, surface_i: int) -> bool:
    """Stem rank may be a bit worse than the surface, not many times worse."""
    return stem_i <= surface_i * 4


class EnglishStemmer:
    """Map inflected forms onto a more frequent lemma already in the vocabulary.

    run/runs/running collapse. runner and teacher do not: plain -er/-est are
    kept (bigger stays a neighbor of big). -ier/-iest still fold (happier →
    happy), and irregular better/best/worse/worst fold too.
    When several stems are possible, the most frequent close one wins.
    A stem may be a little rarer than the inflection (hours → hour) but not
    a rare byform (morning stays morning, not morn).
    """

    def lemma(self, word: str, index: dict[str, int]) -> str:
        if word in KEEP_LEMMA or word not in index:
            return word
        surface_i = index[word]
        irregular_target = IRREGULAR.get(word)
        best: str | None = None
        best_i: int | None = None
        for cand in self._candidates(word, index.__contains__):
            if cand not in index or cand == word:
                continue
            # Block thing → the. Keep irregular folds such as got → get and was → be.
            if cand in NON_CONTENT and cand not in PREFER_BARE and cand != irregular_target:
                continue
            if not _stem_is_close(index[cand], surface_i):
                continue
            if best_i is None or index[cand] < best_i:
                best = cand
                best_i = index[cand]
        if best is None or best_i is None:
            return word
        # One extra hop so ates → ate → eat when ate is only an irregular form.
        nxt = IRREGULAR.get(best)
        if (
            nxt
            and nxt in index
            and nxt != word
            and nxt not in NON_CONTENT
            and _stem_is_close(index[nxt], surface_i)
            and index[nxt] < best_i
        ):
            return nxt
        return best

    def _candidates(self, word: str, known) -> list[str]:
        found: list[str] = []
        irr = IRREGULAR.get(word)
        if irr:
            found.append(irr)
        if len(word) <= 3:
            return found
        if word.endswith("ies") and len(word) > 4:
            self._add(found, word[:-3] + "y", known)
        # Crawl spellings like eatin / nothin.
        if word.endswith("in") and not word.endswith("ing") and len(word) > 4:
            ing = word[:-2] + "ing"
            self._add(found, ing, known, min_len=5)
            if known(ing):
                found.extend(self._verbal(ing[:-3], known))
        if word.endswith("ing") and len(word) >= 5:
            found.extend(self._verbal(word[:-3], known))
        if word.endswith("ied") and len(word) > 4:
            self._add(found, word[:-3] + "y", known)
        if word.endswith("ed") and len(word) > 4:
            found.extend(self._verbal(word[:-2], known))
        if word.endswith("iest") and len(word) > 5:
            self._add(found, word[:-4] + "y", known, min_len=4)
        if word.endswith("ier") and len(word) > 4:
            self._add(found, word[:-3] + "y", known, min_len=4)
        if word.endswith("es") and len(word) > 4:
            # horses → horse, and only then boxes → box. themes → theme, not them.
            self._add(found, word[:-1], known)
            if word[:-1] not in found:
                self._add(found, word[:-2], known)
        elif word.endswith("s") and not word.endswith("ss"):
            self._add(found, word[:-1], known)
        return found

    def _verbal(self, base: str, known) -> list[str]:
        """Stems for -ing and -ed, including e-drop and consonant doubling."""
        found: list[str] = []
        undoubled = self._undouble(base)
        # running → run, stopped → stop. added keeps add, because "add" is a word.
        if undoubled and not known(base):
            self._add(found, undoubled, known)
        if base in PREFER_BARE:
            self._add(found, base, known, min_len=2)
        # making → make, hoping → hope. thing → the is rejected as non-content.
        self._add(found, base + "e", known)
        if len(base) >= 3:
            self._add(found, base, known)
        return found

    def _add(self, found: list[str], stem: str, known, min_len: int = 3) -> None:
        if len(stem) >= min_len and known(stem) and stem not in found:
            found.append(stem)

    def _undouble(self, base: str) -> str | None:
        if len(base) >= 3 and base[-1] == base[-2] and base[-1] not in VOWELS:
            return base[:-1]
        return None


class IdentityStemmer:
    """Placeholder for languages that do not have a stemmer yet."""

    def lemma(self, word: str, index: dict[str, int]) -> str:
        return word


def make_stemmer(lang: str) -> EnglishStemmer | IdentityStemmer:
    if lang == "en":
        return EnglishStemmer()
    return IdentityStemmer()


def self_check() -> None:
    # Earlier in the list = more frequent.
    words = [
        "the", "be", "do", "go", "good", "new", "man", "child", "run", "cat",
        "city", "box", "make", "stop", "carry", "happy", "big", "hope", "hop",
        "horse", "theme", "them", "paint", "build", "use", "us", "walk", "love",
        "bad", "sing", "singe", "add", "see", "thing", "morning", "news",
        "teacher", "runner", "running", "runs", "ran", "cats", "cities", "boxes",
        "making", "stopped", "carried", "happier", "happiest", "bigger", "biggest",
        "children", "went", "better", "best", "worse", "doing", "doe", "using",
        "walking", "loved", "men", "hoping", "hopping", "horses", "themes",
        "painting", "building", "singing", "added",
    ]
    index = {word: i for i, word in enumerate(words)}
    stem = EnglishStemmer()
    expect = {
        "running": "run",
        "runs": "run",
        "ran": "run",
        "cats": "cat",
        "cities": "city",
        "boxes": "box",
        "making": "make",
        "stopped": "stop",
        "carried": "carry",
        "happier": "happy",
        "happiest": "happy",
        "bigger": "bigger",
        "biggest": "biggest",
        "children": "child",
        "went": "go",
        "better": "good",
        "best": "good",
        "worse": "bad",
        "teacher": "teacher",
        "runner": "runner",
        "news": "news",
        "thing": "thing",
        "morning": "morning",
        "hoping": "hope",
        "hopping": "hop",
        "horses": "horse",
        "themes": "theme",
        "painting": "paint",
        "building": "build",
        "doing": "do",
        "using": "use",
        "walking": "walk",
        "loved": "love",
        "men": "man",
        "singing": "sing",
        "added": "add",
    }
    failed = []
    for surface, lemma in expect.items():
        got = stem.lemma(surface, index)
        if got != lemma:
            failed.append(f"{surface} → {got}, expected {lemma}")
    sparse = {"hour": 80, "hours": 30, "morning": 100, "morn": 10000, "run": 10, "running": 40}
    if stem.lemma("hours", sparse) != "hour":
        failed.append(f"hours → {stem.lemma('hours', sparse)}, expected hour")
    if stem.lemma("morning", sparse) != "morning":
        failed.append(f"morning → {stem.lemma('morning', sparse)}, expected morning")
    if stem.lemma("running", sparse) != "run":
        failed.append(f"running → {stem.lemma('running', sparse)}, expected run")
    dialect = {"eat": 10, "eating": 30, "eatin": 40, "nothing": 15, "nothin": 50}
    if stem.lemma("eatin", dialect) != "eat":
        failed.append(f"eatin → {stem.lemma('eatin', dialect)}, expected eat")
    if stem.lemma("nothin", dialect) != "nothing":
        failed.append(f"nothin → {stem.lemma('nothin', dialect)}, expected nothing")
    if failed:
        raise SystemExit("stemmer self-check failed:\n" + "\n".join(failed))


class ResumeReader:
    """Read a gzip payload from a local prefix, then from HTTP, appending as it goes.

    Closing the socket early leaves a reusable prefix. The next run reads that
    prefix and asks the server for the rest with a Range header.
    """

    def __init__(self, path: Path, url: str):
        self.path = path
        self.url = url
        path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = path.open("a+b")
        self.fh.seek(0, 2)
        self.size = self.fh.tell()
        self.pos = 0
        self.remote = None
        self.restart = False

    def close(self) -> None:
        if self.remote is not None:
            self.remote.close()
            self.remote = None
        self.fh.close()

    def read(self, n: int) -> bytes:
        if n <= 0:
            return b""
        if self.pos < self.size:
            self.fh.seek(self.pos)
            data = self.fh.read(min(n, self.size - self.pos))
            self.pos += len(data)
            if len(data) == n or self.pos < self.size:
                return data
            extra = self._read_remote(n - len(data))
            return data + extra
        return self._read_remote(n)

    def _connect(self) -> None:
        headers = {"User-Agent": USER_AGENT}
        if self.size > 0:
            headers["Range"] = f"bytes={self.size}-"
        req = urllib.request.Request(self.url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=120)
        status = getattr(resp, "status", None) or resp.getcode()
        if self.size > 0 and status == 200:
            # The server ignored Range and would resend the whole file.
            resp.close()
            self.restart = True
            raise RestartDownload()
        if status not in (200, 206):
            resp.close()
            raise OSError(f"download failed with HTTP {status}")
        self.remote = resp
        if self.size == 0:
            log("downloading fastText vectors (streaming, stop after 200k rows)")
        else:
            log(f"resuming fastText download at {self.size / 1_048_576:.1f} MB")

    def _read_remote(self, n: int) -> bytes:
        if self.remote is None:
            self._connect()
        assert self.remote is not None
        data = self.remote.read(n)
        if data:
            self.fh.seek(0, 2)
            self.fh.write(data)
            self.fh.flush()
            self.size += len(data)
            self.pos += len(data)
        return data


class RestartDownload(Exception):
    pass


def cache_paths(lang: str) -> tuple[Path, Path, Path]:
    partial = CACHE / f"cc.{lang}.300.vec.gz.partial"
    npy = CACHE / f"cc.{lang}.300.top{MAX_VECTORS}.npy"
    words = CACHE / f"cc.{lang}.300.top{MAX_VECTORS}.words.txt"
    return partial, npy, words


def load_vector_cache(lang: str) -> tuple[np.ndarray, list[str]] | None:
    _, npy, words_path = cache_paths(lang)
    if not npy.exists() or not words_path.exists():
        return None
    try:
        vecs = np.load(npy, mmap_mode="r")
    except (OSError, ValueError):
        return None
    words = words_path.read_text(encoding="utf-8").splitlines()
    if vecs.ndim != 2 or vecs.shape[1] != VECTOR_DIM or len(words) != vecs.shape[0]:
        return None
    if len(words) < VOCAB_MIN:
        return None
    log(f"using cached vectors: {len(words)} rows from {npy.name}")
    return vecs, words


def save_vector_cache(lang: str, vecs: np.ndarray, words: list[str]) -> None:
    _, npy, words_path = cache_paths(lang)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(npy, vecs)
    words_path.write_text("\n".join(words) + "\n", encoding="utf-8")
    log(f"cached {len(words)} vectors at {npy}")


def parse_vec_line(text: str) -> tuple[str, np.ndarray] | tuple[str, int] | None:
    if not text:
        return None
    space = text.find(" ")
    if space <= 0:
        return None
    word = text[:space]
    rest = text[space + 1 :]
    # Header: "<count> <dim>"
    if word.isdigit() and rest.strip().isdigit():
        return ("__header__", int(rest.strip()))
    vec = np.fromstring(rest, dtype=np.float32, sep=" ", count=VECTOR_DIM)
    if vec.size != VECTOR_DIM:
        return None
    # Reject a short line that fromstring silently truncated.
    if rest.count(" ") < VECTOR_DIM - 1:
        return None
    return word, vec


def stream_top_vectors(lang: str, limit: int) -> tuple[np.ndarray, list[str]]:
    partial, _, _ = cache_paths(lang)
    url = vector_url(lang)
    vecs = np.empty((limit, VECTOR_DIM), dtype=np.float32)
    words: list[str] = []
    reader = ResumeReader(partial, url)
    decomp = zlib.decompressobj(16 + zlib.MAX_WBITS)
    buf = b""
    header_dim: int | None = None
    last_log = 0
    try:
        while len(words) < limit:
            chunk = reader.read(1 << 20)
            if not chunk:
                break
            buf += decomp.decompress(chunk)
            while b"\n" in buf and len(words) < limit:
                raw, buf = buf.split(b"\n", 1)
                text = raw.decode("utf-8", "replace").strip("\r")
                parsed = parse_vec_line(text)
                if parsed is None:
                    continue
                if parsed[0] == "__header__":
                    header_dim = int(parsed[1])
                    if header_dim != VECTOR_DIM:
                        raise SystemExit(f"expected {VECTOR_DIM}-d vectors, file says {header_dim}")
                    continue
                word, vec = parsed
                vecs[len(words)] = vec
                words.append(word)
            if len(words) - last_log >= 10_000:
                last_log = len(words)
                log(f"parsed {len(words)} vectors, downloaded {reader.size / 1_048_576:.1f} MB")
    finally:
        reader.close()
    if len(words) < limit:
        log(f"stream ended early at {len(words)} vectors; continuing with those")
        vecs = vecs[: len(words)].copy()
    else:
        vecs = vecs[: len(words)]
    if len(words) < VOCAB_MIN:
        raise SystemExit(f"only {len(words)} vectors arrived; need at least {VOCAB_MIN} to build a guess list")
    return vecs, words


def acquire_vectors(lang: str) -> tuple[np.ndarray, list[str]]:
    cached = load_vector_cache(lang)
    if cached is not None and len(cached[1]) >= MAX_VECTORS:
        return cached[0][:MAX_VECTORS], cached[1][:MAX_VECTORS]
    last_error: Exception | None = None
    for attempt in range(6):
        try:
            vecs, words = stream_top_vectors(lang, MAX_VECTORS)
            save_vector_cache(lang, vecs, words)
            return vecs, words
        except RestartDownload:
            partial, _, _ = cache_paths(lang)
            partial.unlink(missing_ok=True)
            log("server ignored Range; starting the download over")
            continue
        except zlib.error as exc:
            partial, _, _ = cache_paths(lang)
            if attempt == 0 and partial.exists():
                log(f"partial gzip was unreadable ({exc}); replacing it")
                partial.unlink()
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            last_error = exc
            log(f"download interrupted ({exc}); retry {attempt + 1}/6")
            time.sleep(2 + attempt)
    raise SystemExit(f"could not stream vectors: {last_error}")


def build_vocab(
    lang: str,
    words: list[str],
    vecs: np.ndarray,
    vocab_size: int,
) -> tuple[list[str], np.ndarray]:
    pattern = token_pattern(lang)
    valid: list[tuple[str, int]] = []
    for row, word in enumerate(words):
        if token_ok(word, pattern):
            valid.append((word, row))
    surface_index = {word: order for order, (word, _) in enumerate(valid)}
    stemmer = make_stemmer(lang)
    best_order: dict[str, int] = {}
    chosen_row: dict[str, int] = {}
    exact: dict[str, bool] = {}
    for order, (word, row) in enumerate(valid):
        lemma = stemmer.lemma(word, surface_index)
        if lemma not in surface_index:
            lemma = word
        if lemma not in best_order or order < best_order[lemma]:
            best_order[lemma] = order
        if lemma not in chosen_row or (word == lemma and not exact.get(lemma, False)):
            chosen_row[lemma] = row
            exact[lemma] = word == lemma
    ordered = sorted(best_order, key=best_order.__getitem__)
    if len(ordered) < VOCAB_MIN:
        log(f"warning: only {len(ordered)} lemmas passed the filter (wanted {VOCAB_MIN}–{VOCAB_MAX})")
    take = min(vocab_size, len(ordered))
    if take > VOCAB_MAX:
        take = VOCAB_MAX
    lemmas = ordered[:take]
    matrix = np.empty((len(lemmas), VECTOR_DIM), dtype=np.float32)
    for i, lemma in enumerate(lemmas):
        matrix[i] = vecs[chosen_row[lemma]]
    log(f"guess vocabulary: {len(lemmas)} lemmas from {len(valid)} surface forms in the top {len(words)} vectors")
    return lemmas, matrix


def normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True).astype(np.float32)
    norms[norms == 0] = 1
    return matrix / norms


def assert_output_allowed(path: Path) -> None:
    resolved = path.resolve()
    allowed = OUT_ROOT.resolve()
    if resolved != allowed and allowed not in resolved.parents:
        raise SystemExit(f"refusing to write outside data/wordtron: {resolved}")
    for banned_name in ("en", "fr"):
        banned = (DATA / banned_name).resolve()
        if resolved == banned or banned in resolved.parents:
            raise SystemExit(f"refusing to write catalog files under data/{banned_name}")


def load_targets(lang: str, lemmas: set[str]) -> list[dict]:
    lang_dir = DATA / lang
    themes_dir = lang_dir / "themes"
    if not themes_dir.is_dir():
        raise SystemExit(f"no catalog at {themes_dir}")
    pos_map: dict[str, str] = {}
    pos_path = lang_dir / "word-pos.json"
    if pos_path.exists():
        raw = json.loads(pos_path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            pos_map = {key: value for key, value in raw.items() if isinstance(value, str)}
    grouped: dict[str, list[dict]] = defaultdict(list)
    for path in sorted(themes_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        theme_id = str(data.get("id") or path.stem)
        title = str(data.get("title") or theme_id)
        for word in data.get("words") or []:
            if not isinstance(word, dict):
                continue
            head = str(word.get("en") or word.get("word") or "").strip().lower()
            word_id = str(word.get("id") or "").strip()
            if not head or not word_id:
                continue
            if " " in head or "-" in head or "/" in head:
                continue
            listed_pos = word.get("pos")
            pos = listed_pos if isinstance(listed_pos, str) else pos_map.get(f"{theme_id}\t{word_id}")
            ru = [item.strip() for item in (word.get("ru") or []) if isinstance(item, str) and item.strip()]
            grouped[head].append(
                {
                    "id": word_id,
                    "word": head,
                    "ru": ru,
                    "pos": pos if isinstance(pos, str) else "",
                    "level": str(word.get("level") or ""),
                    "themeTitle": title,
                    "themeId": theme_id,
                }
            )
    chosen: list[dict] = []
    for head, listings in grouped.items():
        if head not in lemmas or head in NON_CONTENT or len(head) < 3:
            continue
        if any("--" in item["id"] for item in listings) and len({item["id"] for item in listings}) > 1:
            continue
        if len({item["id"] for item in listings}) > 1:
            continue
        glosses = [set(item["ru"]) for item in listings if item["ru"]]
        conflict = False
        for i, left in enumerate(glosses):
            for right in glosses[i + 1 :]:
                if left and right and left.isdisjoint(right):
                    conflict = True
                    break
            if conflict:
                break
        if conflict:
            continue
        poses = {item["pos"] for item in listings if item["pos"]}
        if len(poses) != 1 or not poses <= set(CONTENT_POS):
            continue
        pos = next(iter(poses))
        eligible = [item for item in listings if item["level"] in LEVEL_RANK and item["pos"] == pos]
        if not eligible:
            continue
        eligible.sort(key=lambda item: (LEVEL_RANK[item["level"]], item["themeId"] == "general", item["themeId"]))
        best = eligible[0]
        chosen.append(
            {
                "id": best["id"],
                "word": head,
                "translation": ", ".join(best["ru"][:3]),
                "pos": pos,
                "level": best["level"],
                "themeTitle": best["themeTitle"],
            }
        )
    return chosen


def filter_own_lemmas(lang: str, cards: list[dict], lemma_order: dict[str, int]) -> list[dict]:
    stemmer = make_stemmer(lang)
    kept = []
    for card in cards:
        if stemmer.lemma(card["word"], lemma_order) == card["word"]:
            kept.append(card)
    return kept


def pick_targets(cards: list[dict], limit: int, lang: str) -> list[dict]:
    if limit <= 0:
        return sorted(cards, key=lambda card: (card["freq"], card["word"]))
    by_word = {card["word"]: card for card in cards}
    picked: list[dict] = []
    seen: set[str] = set()
    # Probes are concrete catalog words. The most frequent headwords are
    # grammatical ("make", "time") or contraction debris, so they hide whether
    # the neighbors are actually close in meaning.
    for word in PROBES.get(lang, []):
        card = by_word.get(word)
        if card is None or word in seen:
            continue
        seen.add(word)
        picked.append(card)
        if len(picked) >= limit:
            return picked
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for card in cards:
        if card["word"] not in seen:
            buckets[(card["pos"], card["level"])].append(card)
    for bucket in buckets.values():
        bucket.sort(key=lambda card: (card["freq"], card["word"]))
    for _ in range(4):
        if len(picked) >= limit:
            break
        for level in LEVELS:
            for pos in CONTENT_POS:
                bucket = buckets.get((pos, level)) or []
                while bucket and bucket[0]["word"] in seen:
                    bucket.pop(0)
                if not bucket:
                    continue
                card = bucket.pop(0)
                seen.add(card["word"])
                picked.append(card)
                if len(picked) >= limit:
                    return picked
    return picked


def rank_neighbors(
    word: str,
    lemmas: list[str],
    index: dict[str, int],
    matrix: np.ndarray,
    top: int,
) -> tuple[dict[str, int], list[tuple[str, int, float]]]:
    row = index[word]
    sims = matrix @ matrix[row]
    k = min(top, len(lemmas))
    chosen = np.argpartition(-sims, k - 1)[:k]
    chosen = chosen[np.argsort(-sims[chosen], kind="mergesort")]
    if lemmas[int(chosen[0])] != word:
        self_row = row
        chosen = np.array([self_row] + [int(j) for j in chosen if int(j) != self_row], dtype=int)[:k]
    ranks: dict[str, int] = {}
    preview: list[tuple[str, int, float]] = []
    for rank, col in enumerate(chosen, start=1):
        neighbor = lemmas[int(col)]
        ranks[neighbor] = rank
        if rank <= 20:
            preview.append((neighbor, rank, float(sims[int(col)])))
    return ranks, preview


def write_target_files(
    targets: list[dict],
    lemmas: list[str],
    lemma_index: dict[str, int],
    matrix_n: np.ndarray,
    out_dir: Path,
) -> dict[str, list[tuple[str, int, float]]]:
    """Rank every target in batches. Files stay compact so the full pool fits."""
    previews: dict[str, list[tuple[str, int, float]]] = {}
    total = len(targets)
    step = 32
    top = min(TOP_RANKS, len(lemmas))
    for start in range(0, total, step):
        chunk = targets[start : start + step]
        rows = np.array([lemma_index[card["word"]] for card in chunk], dtype=np.int64)
        sims = matrix_n[rows] @ matrix_n.T
        for i, card in enumerate(chunk):
            row = sims[i]
            chosen = np.argpartition(-row, top - 1)[:top]
            chosen = chosen[np.argsort(-row[chosen], kind="mergesort")]
            self_row = int(rows[i])
            if int(chosen[0]) != self_row:
                chosen = np.array([self_row] + [int(j) for j in chosen if int(j) != self_row], dtype=np.int64)[:top]
            ranks: dict[str, int] = {}
            preview: list[tuple[str, int, float]] = []
            for rank, col in enumerate(chosen, start=1):
                neighbor = lemmas[int(col)]
                ranks[neighbor] = rank
                if rank <= 20:
                    preview.append((neighbor, rank, float(row[int(col)])))
            previews[card["word"]] = preview
            payload = {
                "word": card["word"],
                "translation": card["translation"],
                "pos": card["pos"],
                "level": card["level"],
                "themeTitle": card["themeTitle"],
                "ranks": ranks,
            }
            path = out_dir / f"{card['id']}.json"
            assert_output_allowed(path)
            path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        done = min(start + step, total)
        if done == total or done % 160 == 0:
            log(f"wrote {done}/{total} targets")
    return previews


def write_json(path: Path, payload: object) -> None:
    assert_output_allowed(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def report_five(cards: list[dict], previews: dict[str, list[tuple[str, int, float]]]) -> list[dict]:
    picked: list[dict] = []
    seen: set[str] = set()

    def take(pred) -> None:
        for card in cards:
            if card["word"] in seen:
                continue
            if pred(card):
                picked.append(card)
                seen.add(card["word"])
                return

    take(lambda card: card["pos"] == "n" and card["level"] in ("A1", "A2"))
    take(lambda card: card["pos"] == "v" and card["level"] in ("A1", "A2"))
    take(lambda card: card["pos"] == "adj" and card["level"] in ("A1", "A2"))
    take(lambda card: card["pos"] == "n" and card["level"] in ("B1", "B2"))
    take(lambda card: card["pos"] in ("v", "adj") and card["level"] in ("B1", "B2"))
    take(lambda card: card["pos"] == "n")
    take(lambda card: card["pos"] == "v")
    take(lambda card: card["pos"] == "adj")
    for card in cards:
        if len(picked) >= 5:
            break
        if card["word"] not in seen:
            picked.append(card)
            seen.add(card["word"])
    lines = []
    for card in picked[:5]:
        lines.append(
            f"\n{card['word']}  ({card['pos']}, {card['level']}, {card['themeTitle']})  — {card['translation']}"
        )
        for neighbor, rank, cosine in previews[card["word"]]:
            lines.append(f"  {rank:2d}  {neighbor:<16}  {cosine:.4f}")
    print("\n".join(lines))
    return picked[:5]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Wordtron semantic neighbor ranks.")
    parser.add_argument("--lang", default="en", help="catalog language under data/ (default: en)")
    parser.add_argument("--limit", type=int, default=20, help="how many target words to build")
    parser.add_argument("--all", action="store_true", help="build every word that passes the filters")
    parser.add_argument("--vocab-size", type=int, default=VOCAB_SIZE, help="guess lemmas, kept inside 30–50k")
    parser.add_argument("--check", action="store_true", help="run the stemmer self-check and exit")
    args = parser.parse_args()
    self_check()
    if args.check:
        print("stemmer self-check ok")
        return
    if args.all:
        args.limit = 0
    elif args.limit < 1:
        raise SystemExit("--limit must be positive")
    vocab_size = args.vocab_size
    if not VOCAB_MIN <= vocab_size <= VOCAB_MAX:
        raise SystemExit(f"--vocab-size must be between {VOCAB_MIN} and {VOCAB_MAX}")
    languages = list_languages()
    if args.lang not in languages:
        raise SystemExit(f"unknown language {args.lang!r}; catalogs: {', '.join(languages)}")

    vecs, words = acquire_vectors(args.lang)
    lemmas, matrix = build_vocab(args.lang, words, vecs, vocab_size)
    lemma_index = {lemma: i for i, lemma in enumerate(lemmas)}
    cards = load_targets(args.lang, set(lemmas))
    cards = filter_own_lemmas(args.lang, cards, lemma_index)
    for card in cards:
        card["freq"] = lemma_index[card["word"]]
    targets = pick_targets(cards, args.limit, args.lang)
    if args.limit > 0 and len(targets) < args.limit:
        log(f"warning: only {len(targets)} catalog targets matched the filters")
    missed = [word for word in PROBES.get(args.lang, []) if word not in {card["word"] for card in targets}]
    if missed:
        log("probes not in this sample: " + ", ".join(missed))
    matrix_n = normalize(matrix)

    out_dir = OUT_ROOT / args.lang
    assert_output_allowed(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    keep_ids = {card["id"] for card in targets}
    for old in out_dir.glob("*.json"):
        if old.name == "vocab.json" or old.stem in keep_ids:
            continue
        assert_output_allowed(old)
        old.unlink()
    previews = write_target_files(targets, lemmas, lemma_index, matrix_n, out_dir)

    write_json(out_dir / "vocab.json", {"language": args.lang, "words": lemmas})
    log(f"wrote vocab.json ({len(lemmas)} words)")

    print(f"vocab {len(lemmas)}")
    print(f"targets {len(targets)}")
    if len(targets) <= 30:
        print("targets: " + ", ".join(f"{card['word']}({card['pos']}/{card['level']})" for card in targets))
        report_five(targets, previews)


if __name__ == "__main__":
    main()
