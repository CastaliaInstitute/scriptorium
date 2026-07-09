# Scriptorium TODO

Goal: implement Scriptorium as the manuscript, marginalia, and sync layer built
on the Readest fork, with Bibliotech and AtelierNymphet publishing EPUBs through
OPDS and Supabase-backed WebDAV.

## Phase 0: Repo Hygiene

- [x] Clone `CastaliaInstitute/scriptorium`.
- [x] Identify `main` as the source branch and `gh-pages` as static deploy output.
- [x] Change Scriptorium's default branch from `gh-pages` to `main`.
- [x] Commit Scriptorium source changes on focused feature branches.
- [x] Keep Bibliotech and AtelierNymphet caller workflow changes separate from unrelated dirty files.

## Phase 1: Shared Scriptorium Infrastructure

- [x] Move reusable Readest revision sync scripts into Scriptorium.
- [x] Move Supabase-backed WebDAV Cloud Run service into Scriptorium.
- [x] Add reusable `sync-epubs-to-webdav` workflow.
- [x] Add reusable `sync-epubs-to-webdav` build hook for generated EPUBs.
- [x] Add reusable `readest-comments-to-issues` workflow.
- [x] Add `deploy-webdav-cloudrun` workflow.
- [x] Document OPDS/WebDAV/Supabase integration.
- [x] Validate Python scripts compile.
- [x] Validate WebDAV service tests pass in in-memory mode.
- [x] Push Scriptorium branch and open PR.
- [ ] Configure required GitHub secrets on Scriptorium:
  `GCP_SERVICE_ACCOUNT_JSON`.
- [ ] Configure required Google Secret Manager secrets:
  `supabase-url`, `supabase-service-role-key`, `readest-webdav-password`.
- [ ] Deploy Cloud Run WebDAV from Scriptorium workflow.
- [ ] Confirm `/healthz`, WebDAV `PROPFIND /`, and `GET /opds` on deployed service.

## Phase 2: Readest Fork Sync Behavior

- [x] Add `bookFileRefresh` module to the Readest app.
- [x] Redownload existing synced EPUBs when remote `uploadedAt` is newer.
- [x] Redownload existing synced EPUBs when remote `metaHash` changes.
- [x] Preserve local `downloadedAt`, `coverDownloadedAt`, and `coverImageUrl` after refresh.
- [ ] Install Scriptorium monorepo dependencies.
- [ ] Run Readest app lint/typecheck/test suite.
- [x] Run focused `bookFileRefresh` unit test.
- [ ] Run local web Readest and verify sync refresh with a changed EPUB.
- [ ] Verify mobile behavior after a changed `Absinthe.epub` syncs.
- [x] Add focused unit tests around `bookFileRefresh` candidate selection.

## Phase 3: Bibliotech Publishing

- [x] Add Bibliotech caller workflow for Scriptorium WebDAV sync.
- [x] Dry-run Bibliotech sync globs locally.
- [x] Configure Bibliotech secrets:
  `READEST_WEBDAV_URL`, `READEST_WEBDAV_USERNAME`, `READEST_WEBDAV_PASSWORD`.
- [x] Run Bibliotech workflow in dry-run mode.
- [x] Build Bibliotech EPUB artifacts inside the GitHub Action before WebDAV sync.
- [ ] Run Bibliotech workflow live against WebDAV.
- [ ] Confirm root WebDAV folder:
  `Bibliotech/`.
- [ ] Confirm Bibliotech EPUBs appear in `/opds`.
- [ ] Decide whether Bibliotech should preserve source paths or flatten by
  collection/category.

## Phase 4: AtelierNymphet Publishing

- [x] Add AtelierNymphet caller workflow for La Recherche and Twenty Dollar Words.
- [x] Allowlist the new workflow in AtelierNymphet `.gitignore`.
- [x] Dry-run La Recherche sync globs locally.
- [x] Dry-run Twenty Dollar Words sync globs locally.
- [x] Configure or verify AtelierNymphet WebDAV secrets:
  `READEST_WEBDAV_URL`, `READEST_WEBDAV_USERNAME`, `READEST_WEBDAV_PASSWORD`.
- [x] Configure AtelierNymphet `GEMINI_API_KEY`.
- [x] Configure AtelierNymphet `SOURCE_REPO_TOKEN` for private source-map
  sparse checkouts.
- [x] Run AtelierNymphet workflow in dry-run mode.
- [ ] Run AtelierNymphet workflow live against WebDAV.
- [ ] Confirm root WebDAV folders:
  `La Recherche/`, `Twenty Dollar Words/`.
- [ ] Confirm `/opds` exposes La Recherche and Twenty Dollar Words EPUBs.
- [ ] Confirm Readest can import/sync those EPUBs with cover art.

## Phase 5: Annotation Review Loop

- [x] Centralize Readest JSON download, annotation ingest, and Gemini issue creation scripts.
- [x] Add reusable comments-to-issues workflow.
- [x] Verify Readest export JSON layout from live WebDAV.
- [x] Verify AtelierNymphet source map path:
  `LaRecherche/output/rag/rag-ingest-manifest.jsonl`.
- [x] Add reusable workflow hook to build generated source maps before Readest
  annotation ingest.
- [x] Pass an optional source repository token to generated source-map builds.
- [x] Run annotation workflow in dry-run mode.
- [x] Confirm generated issues include:
  Readest deep links, source refs, highlight text, note text, and cross-reference links.
- [x] Add reusable workflow hook to generate source-edit proposal artifacts.
- [x] Enable source-edit proposal artifacts from AtelierNymphet's annotation workflow.
- [ ] Run annotation workflow live and create test issue.
- [x] Add duplicate prevention tests around issue keys.
- [ ] Decide whether issues land in source repos directly or in Scriptorium first.

## Phase 6: Cross-References and Marginalia

- [ ] Define canonical cross-reference URI schema.
- [x] Support datetime-stamped message/email references, for example:
  `facebook:daniel-du-kinque:2026.07.02.02:24`.
- [x] Add parser for explicit cross-references in notes and marginalia.
- [ ] Add generated footnote/endnote references between La Recherche and Twenty Dollar Words.
- [ ] Add source-map links from EPUB CFI to repository path/span.
- [ ] Add optional marginalia layers:
  personal, faculty, public, AI review.
- [x] Persist parsed annotation cross-references as durable JSON objects, not only UI state.

## Phase 7: Manuscript Editing

- [ ] Choose the first editing surface:
  EPUB annotation editor, Markdown-backed editor, or Codex document editor.
- [ ] Define Codex document model.
- [ ] Map Codex passages to repo source files.
- [x] Generate patch proposal artifacts from mapped annotations.
- [x] Upload patch proposal artifacts from the annotation workflow.
- [x] Gate patch proposals on explicit accepted proposal keys.
- [x] Add helper to open GitHub PRs from accepted source-edit proposals.
- [ ] Rebuild EPUBs after accepted edits.
- [ ] Resync updated EPUBs and verify Readest auto-refresh.

## Phase 8: Release and Operations

- [x] Document local dev setup for Scriptorium.
- [x] Document deploy setup for Cloud Run and GitHub Actions.
- [x] Add smoke verifier for deployed WebDAV and OPDS.
- [ ] Run smoke verifier against deployed WebDAV and OPDS.
- [x] Add a release checklist for Scriptorium reader builds.
- [x] Add a runbook for failed sync, missing covers, and deleted-book tombstones.
- [x] Decide public/private policy for Bibliotech, AtelierNymphet, and review artifacts.

## Current Completion Criteria

- Scriptorium source branch merged.
- WebDAV deployed from Scriptorium and serving OPDS.
- Bibliotech and AtelierNymphet can publish EPUBs through reusable workflows.
- Readest fork redownloads changed EPUBs on sync.
- A Readest highlight/note can become a Gemini-summarized GitHub issue with
  source links.
- Accepted source edits can rebuild and republish EPUBs without manual
  reimport on the reader device.
