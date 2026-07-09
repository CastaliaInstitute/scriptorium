# Scriptorium Cross-Reference URI Schema

Scriptorium cross-references preserve the text a reader wrote while adding a
stable machine address that can survive issue creation, AI review, EPUB rebuilds,
and later reader navigation.

Parsed references use:

```json
{
  "schema": "scriptorium.cross-reference.v1",
  "kind": "datetime-anchor",
  "raw": "facebook:daniel-du-kinque:2026.07.02.02:24",
  "target": "facebook:daniel-du-kinque:2026.07.02.02:24",
  "canonical_uri": "scriptorium://message/facebook/daniel-du-kinque/2026.07.02.02%3A24"
}
```

## Canonical URI Forms

Message and email anchors:

```text
scriptorium://message/{scheme}/{namespace}/{YYYY.MM.DD.HH%3AMM}
```

Examples:

```text
facebook:daniel-du-kinque:2026.07.02.02:24
scriptorium://message/facebook/daniel-du-kinque/2026.07.02.02%3A24
```

Works and passages:

```text
scriptorium://work/{work-slug}/{path...}
```

Examples:

```text
larecherche/absinthe/chapter-1
scriptorium://work/la-recherche/absinthe/chapter-1

tdw/absinthe/green-hour
scriptorium://work/twenty-dollar-words/absinthe/green-hour
```

External URLs and Readest deep links keep their original URI as the canonical
URI:

```text
https://example.test/a
readest://book/abc/annotation/def
```

## Fields

- `schema`: currently `scriptorium.cross-reference.v1`.
- `kind`: parser classification, such as `datetime-anchor`, `la-recherche`,
  `twenty-dollar-words`, `readest-deep-link`, or `url`.
- `raw`: exact reference token found in the annotation text, after trimming
  trailing punctuation.
- `target`: clickable target used in issue/review packet rendering.
- `canonical_uri`: stable Scriptorium address used by automation.
- `scheme`, `namespace`, `timestamp`: present for datetime-stamped anchors.

## Rules

- Preserve `raw`; never replace the reader's note text with a normalized value.
- Use `canonical_uri` for deduplication and machine joins.
- Use `target` for human-facing links.
- Percent-encode path segments and timestamps inside canonical URIs.
- Treat unknown references as prose until a parser rule is added.
