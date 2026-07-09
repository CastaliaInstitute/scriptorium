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
      remote_prefix: "La Recherche"
      flatten: true
      mirror: false
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
      issue_limit: 20
      dry_run: false
    secrets:
      READEST_WEBDAV_URL: ${{ secrets.READEST_WEBDAV_URL }}
      READEST_WEBDAV_USERNAME: ${{ secrets.READEST_WEBDAV_USERNAME }}
      READEST_WEBDAV_PASSWORD: ${{ secrets.READEST_WEBDAV_PASSWORD }}
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
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

## Optional Variables

```text
GEMINI_READEST_ISSUE_MODEL
```

Defaults to `gemini-3.5-flash`.

## Local Development

```sh
python3 -m py_compile scripts/*.py
python3 scripts/sync_epubs_to_webdav.py --dry-run --flatten --mirror "output/epub/*.epub"
python3 scripts/create_readest_review_issues.py --input /tmp/readest-ingest-output-2/readest-annotations.mapped.jsonl --dry-run --limit 1
```

## Boundary

EPUBs are artifacts. Accepted edits must be applied to the source repositories
and then rebuilt into EPUBs.
