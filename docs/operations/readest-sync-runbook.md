# Readest Sync Operations Runbook

This runbook is for the Scriptorium WebDAV/OPDS service and the Readest fork
sync path used by Bibliotech and AtelierNymphet.

## First Checks

Confirm the active surfaces before changing data:

```sh
cd tools/readest-webdav-cloudrun
npm run smoke -- \
  --url "$READEST_WEBDAV_URL" \
  --username "$READEST_WEBDAV_USERNAME" \
  --password "$READEST_WEBDAV_PASSWORD" \
  --expect-folder "Bibliotech" \
  --expect-folder "La Recherche" \
  --expect-folder "Twenty Dollar Words"
```

Expected results:

- `GET /healthz` returns `ok`.
- `OPTIONS /` returns WebDAV capability headers.
- `PROPFIND /` exposes root-level collection folders.
- `GET /opds` returns an OPDS acquisition feed.

If auth fails, fix credentials before investigating Readest. GitHub caller
secrets and Cloud Run Secret Manager values must match:

```text
READEST_WEBDAV_URL
READEST_WEBDAV_USERNAME
READEST_WEBDAV_PASSWORD
readest-webdav-password
```

Do not print secret values in logs or chat output. Pipe them directly from the
secret manager to `gh secret set` when possible.

## Expected Remote Layout

The root WebDAV folder should expose:

```text
/Bibliotech/
/La Recherche/
/Twenty Dollar Words/
```

Readest's integration root directory should be empty or `/`. Do not configure a
Readest root directory such as `Readest` unless intentionally testing a legacy
layout.

Use OPDS for discovery/import and WebDAV for sync. Readest does not
automatically derive WebDAV sync state from `/opds`; OPDS entries only advertise
acquisition links.

## Publishing Books

Run caller workflows in dry-run mode before live sync:

```sh
gh workflow run sync-scriptorium-webdav.yml \
  --repo AtelierNymphet/AtelierNymphet \
  --ref main \
  -f dry_run=true
```

Then run live:

```sh
gh workflow run sync-scriptorium-webdav.yml \
  --repo AtelierNymphet/AtelierNymphet \
  --ref main \
  -f dry_run=false \
  -f mirror=false
```

Use `mirror=true` only when the local build output is authoritative for that
remote prefix. It deletes remote EPUBs under the prefix that are no longer
present locally.

## Missing Books

Check these in order:

1. The caller workflow built EPUBs before sync.
2. The sync logs show `PUT` lines for the expected files.
3. `PROPFIND /<series>/` lists those files.
4. `/opds` includes the expected title or href.
5. Readest is connected to the same WebDAV URL, username, password, and root.
6. Readest sync strategy is compatible with the intended direction.

For a device that should receive published books, use Readest's Google
Drive/WebDAV sync settings with a receive-capable strategy and run a full sync.
If the device is set to upload-only, it will not pull new remote books.

## Missing Or Stale Covers

Covers can fail to refresh for three different reasons:

- The EPUB does not contain a valid cover declaration.
- Readest has cached a cover from the previous imported file.
- The sync did not redownload the changed book file.

Operational checks:

1. Rebuild the EPUB and verify its package metadata declares the intended cover.
2. Confirm the workflow uploaded the changed EPUB, not an old artifact.
3. Confirm the remote synced book has a newer `uploadedAt` value or changed
   `metaHash`.
4. Run Readest full sync on a Scriptorium build that includes
   `bookFileRefresh`.

The Scriptorium Readest fork refreshes existing synced EPUBs when `uploadedAt`
or `metaHash` changes. Stock Readest may require delete/reimport for the same
book file.

## Deleted Books Not Disappearing

By default, Scriptorium sync uploads or overwrites EPUBs and does not delete
remote books. This prevents accidental data loss when a build command emits a
partial set.

Use a mirror sync only for a prefix whose local EPUB output is complete:

```sh
gh workflow run sync-scriptorium-webdav.yml \
  --repo AtelierNymphet/AtelierNymphet \
  --ref main \
  -f dry_run=false \
  -f mirror=true
```

After remote deletion, run Readest full sync. If a local Readest library entry
was manually imported and is not tied to sync metadata, delete it locally.

## Legacy Layout Cleanup

If the root shows `Readest/` or nested `Readest/Readest/` instead of the series
folders, migrate storage objects before asking users to resync.

Dry-run first:

```sh
cd tools/readest-webdav-cloudrun
node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest \
  --target-prefix "" \
  --dry-run
```

Delete legacy objects only after the root-level layout and OPDS feed have been
validated:

```sh
node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest \
  --target-prefix "" \
  --delete-source
```

## Annotation And Edit Loop

Run annotation ingest in dry-run mode before creating issues:

```sh
gh workflow run readest-comments-to-issues.yml \
  --repo AtelierNymphet/AtelierNymphet \
  --ref main \
  -f dry_run=true \
  -f generate_edit_proposals=true \
  -f edit_proposals_use_ai=true
```

Accepted source edits require explicit proposal keys. Do not apply every AI
proposal in an artifact:

```sh
python3 tools/readest-revision-sync/scripts/apply_accepted_readest_source_edits.py \
  --input .atelier/readest-edit-proposals/readest-source-edit-proposals.jsonl \
  --accept-key "$PROPOSAL_KEY" \
  --workspace-root /path/to/workspace \
  --branch readest/source-edits \
  --commit-message "Apply accepted Readest source edits" \
  --create-pr
```

After the PR merges in the source repo, rebuild EPUBs and run the WebDAV sync
workflow again. Scriptorium Readest clients should refresh on their next full
sync when the updated remote metadata changes.

The repeatable version is:

1. Use `apply-accepted-edits-and-publish.yml` from
   `tools/readest-revision-sync/examples` in the source repo to create the
   accepted-edit PR.
2. Protect the source branch and review the PR normally.
3. On merge to `main`, run a publish workflow that calls
   `sync-epubs-to-webdav.yml` with the repo's EPUB build command.
4. In Readest, run full sync on Scriptorium builds; changed files are
   redownloaded when `uploadedAt` or `metaHash` changes.
