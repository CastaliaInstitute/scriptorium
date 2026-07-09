# Scriptorium Manuscript Editing Model

Scriptorium treats EPUBs as reader artifacts and repository files as source of
truth. The first editing surface is therefore not direct EPUB mutation. It is a
Readest annotation-to-source review loop:

1. Read and annotate in Scriptorium Readest.
2. Export/sync annotations through WebDAV.
3. Map annotations to repository source spans through source maps.
4. Generate review issues and optional source-edit proposals.
5. Apply accepted proposals to source files.
6. Rebuild EPUBs from source and resync.
7. Let Scriptorium Readest refresh changed book files on full sync.

This keeps manuscripts editable without making EPUB files canonical.

## First Editing Surface

The first editing surface is source-backed marginalia review:

- Reader intent is captured in highlights, notes, cross-references, and
  accepted proposal keys.
- GitHub issues are the review queue.
- Pull requests are the source-edit application surface.
- EPUBs are rebuilt after merge.

Inline EPUB annotation editing and a Markdown-backed editor remain future UI
surfaces. They should write into the same Codex/passage model rather than
creating a separate source of truth.

## Codex

A Codex is a writable logical work. It may have multiple physical editions:

```json
{
  "schema": "scriptorium.codex.v1",
  "codex_id": "ateliernymphet:larecherche:absinthe",
  "repository": "AtelierNymphet/AtelierNymphet",
  "work_slug": "absinthe",
  "series": "La Recherche",
  "title": "Absinthe",
  "source_ref": "main",
  "source_root": "Absinthe/",
  "artifact_paths": [
    "La Recherche/Absinthe.epub"
  ]
}
```

Required fields:

- `schema`: `scriptorium.codex.v1`.
- `codex_id`: stable owner/collection/work identifier.
- `repository`: owning source repository.
- `work_slug`: source-map work slug.
- `title`: reader-facing work title.
- `source_ref`: branch, tag, or commit used to build the artifact.
- `artifact_paths`: published EPUB paths in WebDAV/OPDS.

Optional fields include `series`, `series_index`, `source_root`,
`rights_policy`, and `visibility`.

## Passage

A passage is a stable addressable unit inside a Codex. It bridges reader
locations and source spans:

```json
{
  "schema": "scriptorium.passage.v1",
  "codex_id": "ateliernymphet:larecherche:absinthe",
  "passage_id": "ateliernymphet:larecherche:absinthe:chapter-1#green-hour",
  "canonical_ref": "https://ateliernymphet.com/larecherche/absinthe/chapter-1#green-hour",
  "source": {
    "repository": "AtelierNymphet/AtelierNymphet",
    "ref": "main",
    "path": "Absinthe/source/chapter-1.md",
    "char_start": 10,
    "char_end": 42
  },
  "reader": {
    "book_hash": "readest-book-hash",
    "cfi": "epubcfi(/6/2!/4/1:0)",
    "fragment": "green-hour"
  }
}
```

Required fields:

- `schema`: `scriptorium.passage.v1`.
- `codex_id`: owning Codex.
- `passage_id`: stable passage identifier.
- `canonical_ref`: human/source-map canonical reference.
- `source.repository`, `source.ref`, `source.path`: repository source anchor.

`source.char_start` and `source.char_end` are required for automatic patch
proposal application. `reader.cfi` is retained when exported by Readest, even
when source matching is text-based.

## Marginalia

Marginalia attaches reader intent to a passage:

```json
{
  "schema": "scriptorium.marginalia.v1",
  "marginalia_id": "readest:bookhash:note-id:content-hash",
  "codex_id": "ateliernymphet:larecherche:absinthe",
  "passage_id": "ateliernymphet:larecherche:absinthe:chapter-1#green-hour",
  "layer": "personal",
  "kind": "note",
  "highlight": "The selected passage.",
  "note": "Compare tdw/absinthe/green-hour",
  "cross_references": [],
  "readest": {
    "book_hash": "bookhash",
    "annotation_id": "note-id",
    "deep_link": "readest://book/bookhash/annotation/note-id"
  }
}
```

Layers:

- `personal`: reader-owned notes and highlights.
- `faculty`: curated review or teaching marginalia.
- `public`: cleared notes that may ship with a public edition.
- `ai-review`: generated review material requiring human acceptance.

Only accepted source-edit proposal keys may become source changes.

## Mapping Rules

1. Prefer source-map exact text matches for highlights.
2. Use `work_slug` or title slug to narrow candidates.
3. Preserve CFI even when no source span is found.
4. Quarantine unmapped annotations rather than guessing a source file.
5. Require `source.path`, `char_start`, and `char_end` before applying a patch.
6. Rebuild EPUB artifacts from source after accepted edits.

## Current Implementation

Current tooling implements this model in stages:

- `ingest_readest_annotations.py` normalizes Readest annotations, source-map
  matches, deep links, and cross-references.
- `propose_readest_source_edits.py` creates source-edit proposal artifacts from
  mapped marginalia.
- `apply_accepted_readest_source_edits.py` applies only explicitly accepted
  proposal keys to repository source files and can open a pull request.
- Caller repository workflows rebuild and publish EPUB artifacts.
