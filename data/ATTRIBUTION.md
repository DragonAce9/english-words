# Dictionary attribution

The learner JSON in `data/themes/` is an adaptation of open bilingual data. It is **not** copied from proprietary dictionaries (Mueller, Lingvo, Quizlet, etc.).

## FreeDict English–Russian (primary source)

- **Work:** English–Русский FreeDict+WikDict dictionary
- **Edition:** 2025.11.23
- **License:** [Creative Commons Attribution-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/legalcode) (CC BY-SA 3.0)
- **Download:** https://download.freedict.org/dictionaries/eng-rus/
- **Maintainer:** Karl Bartel
- **Project:** [FreeDict](https://www.freedict.org/)
- **Pipeline:** [WikDict](https://www.wikdict.com/) from [Wiktionary](https://www.wiktionary.org/) via [DBnary](http://kaiko.getalp.org/about-dbnary/)

Share-alike: this adaptation (thematic JSON for the Mini App) is offered under **CC BY-SA 3.0**. If you reuse or modify `data/themes/*.json`, keep this attribution and share derivatives under CC BY-SA 3.0 (or a compatible later licence as allowed by the source).

## Frequency filter (not a translation source)

- **Work:** [google-10000-english](https://github.com/first20hours/google-10000-english) (`google-10000-english-no-swears.txt`)
- **License:** MIT
- **Use:** include common headwords and cap the paid `general` theme; translations still come from FreeDict.

## How this repo uses the sources

`scripts/import-freedict.ts` downloads the FreeDict TEI, keeps learner-like single headwords with Cyrillic translations, drops slang/obsolete senses and proper names, assigns a word to every matching thematic bucket (canonical id = slug of `en`), and writes `data/themes/*.json`. Unmatched leftovers go to `general`.

Curated learner lists in `data/seeds/` (connectors, irregular principal parts, popular verbs) are merged on import. Seed translations are authored for learning; FreeDict may enrich Russian glosses by lemma when present.
