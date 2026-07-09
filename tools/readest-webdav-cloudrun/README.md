# Readest WebDAV on Cloud Run

This service exposes a small WebDAV facade for Readest and stores files in a private Supabase Storage bucket. It is intended for Google Cloud Run with `min-instances=0`, so it can scale to zero when idle.

Readest should point at the Cloud Run service URL and use the Basic Auth username/password configured below.

## Required Google Cloud Setup

Enable the services once:

```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

Create Secret Manager secrets. Do not paste secret values into this repo:

```sh
printf '%s' "$SUPABASE_URL" | gcloud secrets create supabase-url --data-file=-
printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | gcloud secrets create supabase-service-role-key --data-file=-
printf '%s' "$WEBDAV_PASSWORD" | gcloud secrets create readest-webdav-password --data-file=-
```

Create a private Supabase Storage bucket named `readest`, or change `SUPABASE_STORAGE_BUCKET` during deploy.

## Deploy

From this directory:

```sh
chmod +x deploy.sh
./deploy.sh
```

The deploy script uses:

- `--min-instances 0` for scale-to-zero
- `--no-invoker-iam-check` so WebDAV clients can reach the service
- Basic Auth inside the service for Readest access
- Secret Manager for Supabase and WebDAV credentials

Optional overrides:

```sh
REGION=us-west1 \
SERVICE_NAME=readest-webdav \
SUPABASE_STORAGE_BUCKET=readest \
WEBDAV_USERNAME=readest \
WEBDAV_ROOT_PREFIX= \
WEBDAV_HIDE_LEGACY_ROOT_FOLDER=true \
WEBDAV_LEGACY_TOP_LEVEL_PREFIX= \
WEBDAV_VIRTUAL_ROOT_ALIASES= \
./deploy.sh
```

## Readest Settings

Use:

- WebDAV URL: the Cloud Run service URL
- Username: `WEBDAV_USERNAME`
- Password: the value stored in `readest-webdav-password`
- Root directory: leave empty, or use `/` (this keeps your series folders at the WebDAV root)
- If your bucket has a historical top-level `Readest/Readest/...` tree, keep `WEBDAV_HIDE_LEGACY_ROOT_FOLDER=true` to hide it from clients while migrating.
- If your bucket still has an old `Readest/...` tree, set
  `WEBDAV_LEGACY_TOP_LEVEL_PREFIX=Readest` (temporarily) to hide non-legacy children
  while you run cleanup.
- If you need the WebDAV root to present friendly series folders before the bucket
  is migrated, set `WEBDAV_VIRTUAL_ROOT_ALIASES`, for example:
  `La Recherche=Readest/Readest;Twenty Dollar Words=Readest`

The service stores remote files below `WEBDAV_ROOT_PREFIX` inside the Supabase bucket.

### Legacy layout cleanup

If the bucket contains legacy objects under `Readest/...`, use the migration helper
before/after flipping to the root-level series layout:

```sh
node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Absinthe \
  --target-prefix "Twenty Dollar Words/Absinthe" \
  --dry-run

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Isibella \
  --target-prefix "Twenty Dollar Words/Isibella" \
  --dry-run

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Mircalla \
  --target-prefix "Twenty Dollar Words/Mircalla" \
  --dry-run

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/ReturnToTheChateau \
  --target-prefix "Twenty Dollar Words/ReturnToTheChateau" \
  --dry-run

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Readest/library.json \
  --target-path "La Recherche/library.json" \
  --dry-run

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Readest/books \
  --target-prefix "La Recherche/books" \
  --dry-run

# Copy legacy files to root-level prefixes only (keeps originals)

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest \
  --target-prefix "" \
  --dry-run

# Copy legacy files to root-level prefixes and delete old objects once validated

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest \
  --target-prefix "" \
  --delete-source

# Full series layout migration (delete after validation)

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Absinthe \
  --target-prefix "Twenty Dollar Words/Absinthe" \
  --delete-source

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Isibella \
  --target-prefix "Twenty Dollar Words/Isibella" \
  --delete-source

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Mircalla \
  --target-prefix "Twenty Dollar Words/Mircalla" \
  --delete-source

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/ReturnToTheChateau \
  --target-prefix "Twenty Dollar Words/ReturnToTheChateau" \
  --delete-source

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Readest/library.json \
  --target-path "La Recherche/library.json" \
  --delete-source

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest/Readest/books \
  --target-prefix "La Recherche/books" \
  --delete-source

node scripts/migrate_legacy_webdav_prefix.mjs \
  --source-prefix Readest \
  --target-prefix "" \
  --dry-run

# Optional: include fallback full-flatten command only if you intentionally want to move
# every legacy object to root without series mapping.
```

### Notes and annotations

Readest can store user data next to EPUBs as arbitrary files (for example `*.txt`, `*.md`, or `*.json`), so notes/notations written by the app are persisted automatically in the same storage prefix.

Common pattern for human-readable notes:

- `/<series>/<book>/<book>.notes.txt`
- `/<series>/<book>/.notes/<note-id>.json`
- `/<series>/<book>.json` sidecars if your client writes JSON directly.

## Local Smoke Test

```sh
cp .env.example .env
set -a
. ./.env
set +a
npm install
npm start
```

Then:

```sh
curl -i -u "$WEBDAV_USERNAME:$WEBDAV_PASSWORD" -X OPTIONS http://localhost:8080/
curl -i -u "$WEBDAV_USERNAME:$WEBDAV_PASSWORD" -X PROPFIND -H 'Depth: 1' http://localhost:8080/
```

## Local Advanced Test Setup

Run the built-in WebDAV tests (in-memory mode, no Supabase required):

```sh
cd tools/readest-webdav-cloudrun
npm test
```

The test suite uses `WEBDAV_TEST_MODE=1` with an in-memory storage backend to validate:

- authentication and capability headers
- directory creation/listing (`MKCOL`, `PROPFIND`)
- file sync and OPDS feed generation (`GET /opds`)
- `COPY`, `MOVE`, `DELETE`
- `LOCK` / `UNLOCK` responses

## Notes

This implements the WebDAV methods Readest is expected to need: `OPTIONS`, `PROPFIND`, `GET`, `HEAD`, `PUT`, `DELETE`, `MKCOL`, `MOVE`, `COPY`, `LOCK`, and `UNLOCK`.

Locks are accepted for client compatibility but are not enforced. Supabase Storage is object storage, so directories are virtual prefixes, with `MKCOL` represented by a `.keep` object.
