#!/usr/bin/env python3
"""Build a compact English SRT title index from OpenSubtitles subtitles_all.txt."""

from __future__ import annotations

import sys
from pathlib import Path


def pad_imdb(raw: str) -> str:
    digits = "".join(ch for ch in raw.removeprefix("tt") if ch.isdigit())
    return f"tt{digits.zfill(7)}" if digits else ""


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: os-catalog-index.py <subtitles_all.txt> <out.tsv>", file=sys.stderr)
        sys.exit(1)
    dump = Path(sys.argv[1])
    out = Path(sys.argv[2])
    best: dict[str, list[str]] = {}
    with dump.open("r", encoding="utf-8", errors="replace") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        idx = {name: i for i, name in enumerate(header)}
        for line in fh:
            p = line.rstrip("\n").split("\t")
            if len(p) <= idx["MovieKind"]:
                continue
            if p[idx["ISO639"]] != "en" or p[idx["SubFormat"]] != "srt":
                continue
            kind_raw = p[idx["MovieKind"]]
            if kind_raw == "tv":
                kind = "episode"
            elif kind_raw == "movie":
                kind = "movie"
            else:
                continue
            imdb = pad_imdb(p[idx["ImdbID"]])
            if not imdb:
                continue
            season = p[idx["SeriesSeason"]] or "0" if kind == "episode" else "0"
            episode = p[idx["SeriesEpisode"]] or "0" if kind == "episode" else "0"
            parent = pad_imdb(p[idx["SeriesIMDBParent"]]) if kind == "episode" else ""
            key = f"m:{imdb}" if kind == "movie" else f"e:{parent or imdb}:{season}:{episode}"
            row = best.get(key)
            if row:
                row[-1] = str(int(row[-1]) + 1)
                continue
            title = p[idx["MovieName"]].strip()
            best[key] = [title, p[idx["MovieYear"]], kind, imdb, season, episode, parent, "1"]

    rows = sorted(best.values(), key=lambda row: (row[0].lower(), row[1], row[4], row[5]))
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        fh.write("title\tyear\tkind\timdb\tseason\tepisode\tparent\tsrt_count\n")
        for row in rows:
            fh.write("\t".join(row) + "\n")
    movies = sum(1 for row in rows if row[2] == "movie")
    print(f"wrote {out} ({movies} movies, {len(rows) - movies} episodes)")


if __name__ == "__main__":
    main()
