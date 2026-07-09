# Scriptorium Release Checklist

Use this checklist before publishing Scriptorium reader builds or changing the
shared WebDAV/OPDS service used by reader devices.

## Source State

- Confirm `main` is green in GitHub Actions.
- Confirm the release branch contains only intended Scriptorium changes.
- Confirm generated or local-only directories such as `node_modules/` are not
  staged.
- Confirm any source-repo caller workflow changes have already merged in their
  owning repos.

## Local Verification

Run lightweight shared-tool checks:

```sh
python3 -m py_compile tools/readest-revision-sync/scripts/*.py

cd tools/readest-webdav-cloudrun
npm test
```

Run focused Readest refresh tests with a compatible Node runtime:

```sh
cd apps/readest-app
./node_modules/.bin/vitest run src/__tests__/app/library/book-file-refresh.test.ts
```

If the full app suite is run locally, generated vendor assets must exist first:

```sh
pnpm install
pnpm --filter @readest/readest-app setup-vendors
```

## WebDAV And OPDS

- Deploy the Cloud Run WebDAV service from `main` when service code changes.
- Run the WebDAV/OPDS smoke verifier against the deployed URL.
- Confirm root folders:

```text
Bibliotech
La Recherche
Twenty Dollar Words
```

- Confirm `/opds` includes at least one expected acquisition entry after EPUB
  publication.
- Confirm Readest sync root is empty or `/`.

## EPUB Publishing

- Run Bibliotech and AtelierNymphet sync workflows in dry-run mode.
- Verify build logs show expected EPUB outputs.
- Verify live sync logs show expected `PUT` lines.
- Use `mirror=true` only for prefixes with complete local output.
- After source edits merge, rebuild EPUBs before WebDAV sync.

## Reader Behavior

- Verify a Scriptorium Readest build can import or sync a newly published EPUB.
- Verify the library automatically pulls book changes while open, on focus
  return, and after the device comes back online.
- Verify an updated EPUB redownloads when `uploadedAt` or `metaHash` changes.
- Verify cover art appears after refresh.
- Verify deleted remote EPUBs do not remain because of local-only imports.

## Annotation Review

- Run annotation workflow in dry-run mode first.
- Confirm mapped annotations include Readest deep links and source refs.
- Confirm Gemini issue summaries do not expose secrets or private context beyond
  the intended repository audience.
- Generate source-edit proposal artifacts only when a reviewer will inspect
  them.
- Apply accepted edits only with explicit proposal keys.

## Release

- Update release notes for user-visible reader changes.
- Publish a GitHub release or run `.github/workflows/release.yml` manually.
- Confirm platform artifacts are attached to the release:
  macOS, Windows, Linux, Android, and KOReader plugin where applicable.
- For iOS, confirm the build path and signing profile separately because App
  Store/TestFlight distribution depends on Apple account state outside this
  repository.

## Rollback

- Revert the service to the previous Cloud Run revision for WebDAV/OPDS service
  regressions.
- Restore prior EPUB artifacts by rerunning the last known-good caller workflow
  or uploading prior artifacts to the same prefix.
- Disable live annotation issue creation by running the annotation workflow only
  with `dry_run=true`.
