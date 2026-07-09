# Scriptorium Implementation Design

## Purpose

Scriptorium extends Readest from an ebook reader into a manuscript and
marginalia system. It should let a reader annotate, cross-reference, review, and
revise texts while keeping canonical source files in their owning repositories.

Scriptorium is not the library corpus. It is the authoring, review, sync, and
reader extension layer.

## Repository Boundaries

| Repository | Role | Owns |
| --- | --- | --- |
| `CastaliaInstitute/scriptorium` | Readest fork plus shared automation | Reader changes, manuscript tools, marginalia model, reusable workflows, WebDAV service |
| `CastaliaInstitute/bibliotech` | Library corpus and public-domain/private research collection | Gutenberg and other library EPUBs, catalog metadata, corpus ingestion |
| `AtelierNymphet/AtelierNymphet` | Atelier source manuscripts | La Recherche source, Twenty Dollar Words source, EPUB build outputs, RAG source maps |

Source repos publish built EPUB artifacts. Scriptorium consumes those artifacts
through sync/catalog protocols and maps reader marginalia back to source repos.

`main` is the repository default branch and source-of-truth branch for
Scriptorium development. `gh-pages` remains a generated static deploy branch for
GitHub Pages only.

## System Shape

```text
Source repos
  -> build EPUBs, covers, metadata, source maps
  -> publish EPUBs to Scriptorium WebDAV
  -> OPDS catalog exposes acquisitions

Scriptorium Readest fork
  -> imports/syncs books
  -> stores reading progress, notes, highlights, marginalia
  -> redownloads changed synced EPUBs
  -> exports annotations and deep links

Review automation
  -> downloads Readest library/config JSON
  -> maps annotations to source passages
  -> uses Gemini to summarize review issues
  -> opens GitHub issues in source repos
  -> writes source-edit proposal artifacts for accepted review
  -> accepted edits update source, then EPUBs rebuild
```

## Core Concepts

### Codex

A writable book object. A Codex may be an EPUB, manuscript draft,
commonplace book, course reader, review packet, anthology, or published edition.

### Passage

A stable addressable unit inside a Codex. A passage may map to an EPUB CFI,
HTML fragment, Markdown source span, or repository source-map entry.

### Marginalia

First-class content attached to a passage:

- Highlight
- Note
- Comment
- Citation
- Cross-reference
- AI review note
- Human editorial instruction

Marginalia is not just reader UI state. It is durable scholarly material.

### Cross-Reference

A link between passages, works, or external message/email artifacts. References
must preserve provenance and should support datetime-stamped external anchors,
for example:

```text
facebook:daniel-du-kinque:2026.07.02.02:24
```

The first implemented surface is the Readest annotation ingest pipeline. It
extracts explicit references from highlight/note text into durable JSON objects
with `kind`, `raw`, and `target` fields, plus timestamp metadata for
datetime-stamped anchors. Review packets and GitHub issues render those
references as footnote/endnote cross-reference material.

## Storage and Sync

### WebDAV

`tools/readest-webdav-cloudrun` exposes a WebDAV facade backed by Supabase
Storage. It also serves OPDS at `/opds`.

Default root-level collections:

- `Bibliotech`
- `La Recherche`
- `Twenty Dollar Words`

Readest should see these as ordinary WebDAV directories, while OPDS clients can
use `/opds` as an acquisition catalog.

### Supabase

Supabase Storage is the first backend for shared book artifacts and Readest sync
files. Secrets remain in GitHub Secrets or Google Secret Manager, never in repo
source.

Expected buckets:

- `readest`: WebDAV object store
- `book-releases` or equivalent: published book artifacts
- domain-specific private buckets where required

### OPDS

OPDS is the catalog surface. It exposes EPUB acquisition links and cover links
from the same object store used by WebDAV.

Readest WebDAV sync and OPDS catalog browsing are separate behaviors. WebDAV
sync keeps devices current; OPDS offers discovery/import.

## Readest Fork Changes

### Automatic Book Refresh

Scriptorium adds `bookFileRefresh` to the library sync flow. When a synced
remote book has a newer `uploadedAt` value or changed `metaHash`, the local
device redownloads the EPUB and cover during sync.

This makes source repo rebuilds propagate to mobile/desktop readers without
manual delete/reimport.

### Manuscript and Marginalia Roadmap

Readest remains the reader shell, but Scriptorium adds:

- A durable marginalia data model.
- Source-map awareness for manuscripts.
- Cross-book and datetime-stamped references.
- Review packet generation.
- GitHub issue/PR workflows.
- Optional AI review layers.
- Export paths back to EPUB, HTML, Markdown, and repository source.

## Publishing Workflows

### Bibliotech

Bibliotech publishes generated/library EPUBs to:

```text
Bibliotech/
```

The current workflow uses:

```text
CastaliaInstitute/scriptorium/.github/workflows/sync-epubs-to-webdav.yml@main
```

### AtelierNymphet

AtelierNymphet publishes:

```text
La Recherche/
Twenty Dollar Words/
```

La Recherche uses built manuscript EPUBs from each book repository directory.
Twenty Dollar Words uses `.tdw-output/publish/epubs`.

### Annotation Review

The reusable review workflow:

```text
CastaliaInstitute/scriptorium/.github/workflows/readest-comments-to-issues.yml@main
```

It downloads Readest sync JSON, maps annotations to source passages, summarizes
with Gemini, and creates GitHub issues.

The same mapped annotation records can feed
`propose_readest_source_edits.py`, which creates reviewable proposal artifacts
under `.atelier/readest-edit-proposals`. Those artifacts may contain a Gemini
unified diff when credentials are available, or a manual-review prompt and
source context when AI proposal generation is disabled. The proposal step does
not apply patches automatically; it is the bridge between marginalia review and
a later source PR. The reusable annotation workflow can generate these artifacts
with `generate_edit_proposals: true` and upload them as the
`readest-edit-proposals` Actions artifact.

Accepted source edits are applied through an explicit review gate, not directly
from AI output. `apply_accepted_readest_source_edits.py` reads the proposal
JSONL artifact, requires accepted proposal keys supplied by a reviewer, refuses
manual-review proposals, validates unified diffs with `git apply --check`, and
can create a source branch/PR for one target repository. This makes the bridge
from marginalia to source edits auditable while keeping EPUBs as rebuildable
artifacts.

## Security

Required principles:

- No service-role keys, Gemini keys, WebDAV passwords, or GitHub tokens in repo
  files or chat output.
- Caller repos pass secrets through GitHub Actions.
- Cloud Run reads Supabase/WebDAV credentials from Secret Manager.
- Private source EPUBs remain private unless explicitly published.
- Bibliotech public-domain and private collections must be separated by policy,
  path, and bucket where needed.

The operational policy is defined in
[Public And Private Artifact Policy](operations/public-private-policy.md). The
current `readest` Supabase bucket is authenticated private sync infrastructure;
public distribution requires explicit promotion to a separate public surface.

## Milestones

1. Centralize shared automation in Scriptorium.
2. Wire Bibliotech and AtelierNymphet publication workflows.
3. Deploy Supabase-backed WebDAV with OPDS.
4. Validate Readest sync and auto-refresh locally.
5. Add marginalia source mapping and issue creation.
6. Add manuscript editing surfaces.
7. Add accepted-edit application and EPUB rebuild loop.

## Non-Goals

- Do not store all Gutenberg or Atelier source content inside the Readest fork.
- Do not edit EPUB artifacts as canonical source.
- Do not make WebDAV the only catalog interface; OPDS remains the discovery
  surface.
- Do not require stock Readest to support Scriptorium-only features.

## Open Questions

- Should annotation issues be created in source repos directly, or aggregated in
  Scriptorium first and dispatched later?
- What is the first manuscript editing surface: inline EPUB annotation editing,
  Markdown-backed editor, or Codex document editor?
