# Curated theme seeds

Hand-picked lists merged by `scripts/import-freedict.ts` into `data/themes/*.json`.
FreeDict heuristics alone miss multi-word connectors and irregular principal parts.

## Themes

| Seed file | Theme id | Title | Notes |
|-----------|----------|-------|--------|
| `connectors.json` | `connectors` | Слова-связки | Discourse markers / fillers / linking words |
| `irregular-verbs.json` | `irregular-verbs` | Неправильные глаголы | One card per lemma with principal parts |
| `popular-verbs.json` | `popular-verbs` | Самые популярные глаголы | High-frequency verb lemmas |

All three themes are **paid**. Words may also appear in other themes (canonical ids).

## Irregular verb card format

Learner-friendly Quizlet-style cards, compatible with Learn / Match / Test:

```json
{
  "id": "go-went-gone",
  "en": "go / went / gone",
  "ru": ["идти", "ехать"],
  "example": "I go to school every day."
}
```

- **Front (`en`)**: base / Past Simple / Past Participle, separated by ` / `.
- **Back (`ru`)**: meaning(s) of the verb (not form labels).
- **`id`**: slug of `en` (`go-went-gone`), distinct from the lemma id `go` used in other themes.
- Match uses `en` vs `ru[0]`; Test/Learn use the same sides.

Do not put only the lemma in `en` for this theme — the forms are the learning target.
