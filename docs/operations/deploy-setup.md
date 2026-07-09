# Scriptorium Deploy Setup

This document covers the deploy wiring for the Scriptorium WebDAV/OPDS Cloud
Run service and the caller repository workflows that publish EPUBs.

## Branches

`main` is the source branch and repository default. `gh-pages` is reserved for
generated GitHub Pages output.

## Google Cloud

Enable required services once in the target project:

```sh
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

Create or update the Secret Manager entries consumed by Cloud Run:

```text
supabase-url
supabase-service-role-key
readest-webdav-password
```

From `tools/readest-webdav-cloudrun`, bootstrap them idempotently:

```sh
PROJECT_ID=institute-481516 \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
WEBDAV_PASSWORD="$WEBDAV_PASSWORD" \
scripts/bootstrap_gcp_secrets.sh
```

The service reads these secrets at runtime. Do not commit their values and do
not print them in logs.

## Supabase

Create the private Storage bucket used by the WebDAV facade:

```text
readest
```

The default deployed service expects this bucket unless the deploy workflow is
run with a different `storage_bucket` input.

## GitHub Secrets And Variables

In `CastaliaInstitute/scriptorium`, configure:

```text
GCP_SERVICE_ACCOUNT_JSON
```

Optional repository variable:

```text
READEST_WEBDAV_USERNAME
```

If the variable is absent, the deploy workflow uses `readest`.

In each caller repo that publishes EPUBs, configure:

```text
READEST_WEBDAV_URL
READEST_WEBDAV_USERNAME
READEST_WEBDAV_PASSWORD
```

If a caller's `epub_build_command` clones sibling private repositories before
sync, also configure:

```text
SOURCE_REPO_TOKEN
```

For annotation review with Gemini and private source checkouts, configure:

```text
GEMINI_API_KEY
SOURCE_REPO_TOKEN
```

## Deploy Cloud Run

Run the Scriptorium workflow:

```sh
gh workflow run deploy-webdav-cloudrun.yml \
  --repo CastaliaInstitute/scriptorium \
  --ref main \
  -f service_name=readest-webdav \
  -f project_id=institute-481516 \
  -f region=us-west1 \
  -f storage_backend=supabase \
  -f storage_bucket=readest \
  -f webdav_root_prefix= \
  -f webdav_hide_legacy_root_folder=true \
  -f run_smoke=true
```

The workflow runs `tools/readest-webdav-cloudrun/deploy.sh`, which deploys with:

- `min-instances=0`
- `max-instances=3` unless overridden
- unauthenticated Cloud Run invocation
- Basic Auth enforced inside the WebDAV service
- Secret Manager bindings for Supabase and WebDAV credentials

Before deployment, the workflow runs
`tools/readest-webdav-cloudrun/scripts/preflight_gcp_deploy.sh`. The preflight
fails early if the configured account cannot access the project, required APIs
are disabled, required Secret Manager entries are missing, latest secret
versions cannot be read, or Cloud Run services cannot be listed in the target
region.

Optional layout inputs:

- `project_id`: target Google Cloud project. Leave blank to use the project
  embedded in `GCP_SERVICE_ACCOUNT_JSON`.
- `webdav_root_prefix`: storage prefix exposed as the WebDAV root.
- `webdav_hide_legacy_root_folder`: hides the old top-level `Readest/` folder
  while migrating to root-level series folders.
- `webdav_legacy_top_level_prefix`: temporarily hides non-legacy children while
  a specific legacy prefix is being cleaned up.
- `webdav_virtual_root_aliases`: exposes friendly root folders before storage is
  fully migrated, for example
  `La Recherche=Readest/Readest;Twenty Dollar Words=Readest`.

## Verify Deployment

By default, the deploy workflow runs the smoke verifier automatically. It
resolves the deployed Cloud Run URL, reads `readest-webdav-password` from Secret
Manager inside the Actions runner, masks the password, and checks:

- `GET /healthz`
- WebDAV `OPTIONS /`
- WebDAV `PROPFIND /`
- `GET /opds`

The deploy workflow creates the configured root folders with `MKCOL` before it
checks them. This keeps a fresh service deploy from failing before the first
EPUB publish and proves the WebDAV endpoint is writable. The default smoke check
requires these root folders:

```text
Bibliotech
La Recherche
Twenty Dollar Words
```

Override `smoke_expected_folders` with a newline-separated list when testing a
temporary layout. Once EPUBs have been published, pass
`smoke_required_opds_entries` with one or more newline-separated title or href
substrings, such as `Absinthe`.

You can also run the same verifier locally after deploy:

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

```sh
npm run smoke -- \
  --url "$READEST_WEBDAV_URL" \
  --username "$READEST_WEBDAV_USERNAME" \
  --password "$READEST_WEBDAV_PASSWORD" \
  --require-opds-entry "Absinthe"
```

## Publish EPUBs

Caller repos use:

```text
CastaliaInstitute/scriptorium/.github/workflows/sync-epubs-to-webdav.yml@main
```

Required inputs per caller:

- `epub_globs`: files to upload after any build step.
- `epub_build_command`: optional command run from the caller repo before sync.
- `remote_prefix`: top-level remote folder, such as `La Recherche`.
- `flatten`: whether all EPUBs are uploaded directly under `remote_prefix`.
- `mirror`: whether stale remote EPUBs under the prefix are deleted.
- `run_smoke`: whether to verify WebDAV and OPDS after a live sync.
- `smoke_expected_folders`: newline-separated top-level folders that must be
  visible from `PROPFIND /`.
- `smoke_required_opds_entries`: newline-separated title or href substrings
  that must appear in `/opds`.

Optional secret:

- `SOURCE_REPO_TOKEN`: exposed as `GH_TOKEN` during `epub_build_command`, for
  builds that need to clone private source repositories before syncing EPUBs.

Run dry first, then live:

```sh
gh workflow run sync-scriptorium-webdav.yml \
  --repo AtelierNymphet/AtelierNymphet \
  --ref main \
  -f dry_run=true

gh workflow run sync-scriptorium-webdav.yml \
  --repo AtelierNymphet/AtelierNymphet \
  --ref main \
  -f dry_run=false \
  -f mirror=false
```

Use `mirror=true` only when the local EPUB output is complete and authoritative
for that remote prefix.

The sync workflow skips smoke verification during dry runs. On live runs,
enable `run_smoke` so caller workflows fail early if an uploaded series folder
or OPDS entry is not visible to Readest.

## Reauth Recovery

If local `gcloud` commands fail with a reauth error, run:

```sh
gcloud auth login --no-launch-browser --update-adc --brief
```

Complete the browser flow with the intended account, then retry Secret Manager
or deploy commands. Avoid pasting secret values into terminal output; pipe them
directly into destination commands.
