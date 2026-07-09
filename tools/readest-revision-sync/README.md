# Readest Revision Sync

Shared GitHub Actions and scripts for the AtelierNymphet Readest revision loop:

```text
source repo -> EPUB artifact -> Readest WebDAV
Readest notes/highlights -> Gemini issue summary -> GitHub issue -> source edit -> EPUB rebuild
```

This repository is intended to be private. It contains automation glue only; it
does not contain canonical manuscript source or Readest data.

## Reusable Workflows

### Sync EPUBs to WebDAV

Use from a book/source repository that contains built EPUB artifacts:

```yaml
name: Sync EPUBs to Readest

on:
  workflow_dispatch:

jobs:
  sync:
    uses: CastaliaInstitute/scriptorium/.github/workflows/sync-epubs-to-webdav.yml@main
    with:
      epub_globs: "output/epub/*.epub"
      epub_build_command: "npm ci && npm run build:epub"
      remote_prefix: "La Recherche"
      flatten: true
      mirror: false
      run_smoke: true
      smoke_expected_folders: |
        La Recherche
      smoke_required_opds_entries: |
        Absinthe
    secrets:
      READEST_WEBDAV_URL: ${{ secrets.READEST_WEBDAV_URL }}
      READEST_WEBDAV_USERNAME: ${{ secrets.READEST_WEBDAV_USERNAME }}
      READEST_WEBDAV_PASSWORD: ${{ secrets.READEST_WEBDAV_PASSWORD }}
```

`flatten: true` uploads matched EPUBs directly under the configured WebDAV root,
which is the simplest layout for Readest library sync. Use a series-level value
for `remote_prefix` (for example, `La Recherche` or `Twenty Dollar Words`).
`mirror: true` removes remote EPUBs
under `remote_prefix` that are no longer produced by the caller repository; use
it for an aggregate sync repo or a dedicated per-book prefix.

If EPUBs are generated artifacts, set `epub_build_command`. The command runs
from the caller repository after checkout and before the WebDAV sync step, so
the published set can be rebuilt repeatably in GitHub Actions without committing
derived EPUB files.

For live publishes, set `run_smoke: true` and provide newline-separated
`smoke_expected_folders` and `smoke_required_opds_entries`. The reusable
workflow skips smoke checks during `dry_run: true`, then verifies WebDAV root
folders and OPDS title/href substrings immediately after a live upload.

### Readest Comments to Issues

Use from the repository where you want revision issues created:

```yaml
name: Readest Comments to Issues

on:
  workflow_dispatch:
  schedule:
    - cron: "17 10 * * *"

jobs:
  issues:
    uses: CastaliaInstitute/scriptorium/.github/workflows/readest-comments-to-issues.yml@main
    permissions:
      contents: read
      issues: write
    with:
      readest_remote_root: ""
      source_map: "output/rag/rag-ingest-manifest.jsonl"
      source_map_build_command: "python3 scripts/build_rag_ingest_manifest.py"
      issue_limit: 20
      generate_edit_proposals: true
      edit_proposals_use_ai: false
      edit_proposal_limit: 20
      dry_run: false
    secrets:
      READEST_WEBDAV_URL: ${{ secrets.READEST_WEBDAV_URL }}
      READEST_WEBDAV_USERNAME: ${{ secrets.READEST_WEBDAV_USERNAME }}
      READEST_WEBDAV_PASSWORD: ${{ secrets.READEST_WEBDAV_PASSWORD }}
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      SOURCE_REPO_TOKEN: ${{ secrets.SOURCE_REPO_TOKEN }}
```

## Required Secrets

Set these in each caller repository or at the organization level:

```text
READEST_WEBDAV_URL
READEST_WEBDAV_USERNAME
READEST_WEBDAV_PASSWORD
GEMINI_API_KEY
```

`GEMINI_API_KEY` is only required for issue summarization. Without it,
`create_readest_review_issues.py` can still produce fallback issue bodies in
local dry-runs.

The annotation ingest step accepts either a directory containing `library.json`
directly or a parent directory containing a single nested Readest sync folder,
such as `Readest/library.json`. It supports both legacy array-style indexes and
current object-style indexes with a `books` array, and it reads book configs
from either `<hash>/config.json` or `books/<hash>/config.json`. The configured
source map must exist and contain canonical entries; otherwise ingest exits
before issue creation so a bad artifact path cannot silently quarantine every
annotation. For intentional parser-only dry runs, pass
`--allow-empty-source-map`.

If the source map is a generated artifact, set `source_map_build_command` in
the reusable workflow inputs. The command runs from the caller repository after
checkout and before Readest annotation ingest, so repos can keep large JSONL
manifests out of git while still enforcing source-backed review packets. The
build command receives `GH_TOKEN`, using optional `SOURCE_REPO_TOKEN` when set,
so private source repos can be cloned before manifest generation.

Ingested annotations also include a durable `cross_references` array extracted
from highlight/note text. The parser preserves datetime-stamped external
anchors such as `facebook:daniel-du-kinque:2026.07.02.02:24`, Readest deep
links, La Recherche paths, Twenty Dollar Words paths, and ordinary URLs. Issue
bodies and review packets render those references under
`Footnote/Endnote Cross-References` or `Cross-References`.

The reusable comments workflow also generates Markdown endnote artifacts from
mapped annotations:

```sh
python3 scripts/generate_cross_reference_notes.py \
  --input output/readest/readest-annotations.mapped.jsonl \
  --out-dir .atelier/readest-cross-reference-notes
```

The output is one `*.cross-reference-endnotes.md` file per work plus
`summary.json`. EPUB build pipelines can include those Markdown files as an
endnotes appendix, preserving Readest web/app deep links, canonical
`scriptorium://` references, marginalia layer metadata, and La Recherche to
Twenty Dollar Words links.

Mapped records also include a structured `source_link` object with repository,
ref, path, character span, content hash, canonical reference, fragment, and a
GitHub source URL. This is the durable bridge from a Readest annotation/CFI to
the repository source span used for issues and source-edit proposals.

Annotations default to the `personal` marginalia layer. Add an explicit token
such as `layer:faculty`, `[layer:public]`, or `layer:ai-review` in the reader
note to route the record into another layer. Review issues include a
`marginalia-<layer>` label in addition to the base review labels.

Each parsed reference includes `schema`, `kind`, `raw`, `target`, and
`canonical_uri`. See
[`docs/cross-reference-uri-schema.md`](../../docs/cross-reference-uri-schema.md)
for the canonical `scriptorium://message/...` and `scriptorium://work/...`
forms.

### Source Edit Proposals

After annotation ingest, generate reviewable source-edit proposal artifacts from
the mapped records:

```sh
python3 scripts/propose_readest_source_edits.py \
  --input output/readest/readest-annotations.mapped.jsonl \
  --workspace-root .. \
  --out-dir .atelier/readest-edit-proposals
```

With `GEMINI_API_KEY`, the script asks Gemini for a conservative unified diff.
Without a key, or with `--no-ai`, it writes the exact source context and prompt
as a manual-review proposal. The script never applies patches directly; accepted
edits still need a reviewed source change and a rebuilt EPUB.

The reusable comments workflow can run this after annotation mapping by setting
`generate_edit_proposals: true`. It uploads the generated proposal directory as
the `readest-edit-proposals` artifact. Keep `edit_proposals_use_ai: false` for
manual-review prompt artifacts, or set it to `true` to ask Gemini for proposed
unified diffs.

Accepted proposal diffs can be applied only after an explicit human gate. Pass
one or more proposal keys from the artifact; proposals marked
`needs_manual_review` or lacking a unified diff are refused:

```sh
python3 scripts/apply_accepted_readest_source_edits.py \
  --input .atelier/readest-edit-proposals/readest-source-edit-proposals.jsonl \
  --workspace-root .. \
  --accept-key readest-edit:bookhash:note-1:hash \
  --dry-run
```

After review, remove `--dry-run`. To prepare a reviewed source PR in a single
target repository, pass `--branch codex/apply-readest-edits --create-pr`. The
tool validates diffs with `git apply --check`, refuses unaccepted proposal keys,
and never edits EPUB artifacts directly.

For repeatable repository automation, copy
[`examples/apply-accepted-edits-and-publish.yml`](examples/apply-accepted-edits-and-publish.yml)
into the caller repository, or call
`CastaliaInstitute/scriptorium/.github/workflows/apply-accepted-readest-edits.yml@main`
directly. It opens a source-edit PR from explicit accepted proposal keys and can
download the `readest-edit-proposals` artifact from a prior annotation workflow
run by passing `proposal_artifact_run_id`.

Then copy
[`examples/publish-after-accepted-edits.yml`](examples/publish-after-accepted-edits.yml)
or create an equivalent caller workflow that invokes `sync-epubs-to-webdav.yml`
with the repo's `epub_build_command`. After the accepted-edit PR merges, the
publish workflow rebuilds EPUBs from source and syncs the changed files back to
Readest WebDAV. Scriptorium Readest clients then refresh changed books
automatically when remote metadata changes.

## Optional Variables

```text
GEMINI_READEST_ISSUE_MODEL
GEMINI_READEST_EDIT_MODEL
```

Defaults to `gemini-3.5-flash`.

## Local Development

```sh
python3 -m py_compile scripts/*.py
python3 scripts/sync_epubs_to_webdav.py --dry-run --flatten --mirror "output/epub/*.epub"
python3 scripts/create_readest_review_issues.py --input /tmp/readest-ingest-output-2/readest-annotations.mapped.jsonl --dry-run --limit 1
python3 scripts/propose_readest_source_edits.py --input output/readest/readest-annotations.mapped.jsonl --no-ai
python3 scripts/apply_accepted_readest_source_edits.py --input .atelier/readest-edit-proposals/readest-source-edit-proposals.jsonl --accept-key readest-edit:bookhash:note-1:hash --dry-run
python3 scripts/generate_cross_reference_notes.py --input output/readest/readest-annotations.mapped.jsonl
```

## Boundary

EPUBs are artifacts. Accepted edits must be applied to the source repositories
and then rebuilt into EPUBs.
