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

Create or verify the Secret Manager entries consumed by Cloud Run:

```text
supabase-url
supabase-service-role-key
readest-webdav-password
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
  -f region=us-west1 \
  -f storage_backend=supabase \
  -f storage_bucket=readest \
  -f webdav_root_prefix=
```

The workflow runs `tools/readest-webdav-cloudrun/deploy.sh`, which deploys with:

- `min-instances=0`
- `max-instances=3` unless overridden
- unauthenticated Cloud Run invocation
- Basic Auth enforced inside the WebDAV service
- Secret Manager bindings for Supabase and WebDAV credentials

## Verify Deployment

After deploy, run:

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

Once EPUBs have been published, add one or more OPDS acquisition checks:

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

## Reauth Recovery

If local `gcloud` commands fail with a reauth error, run:

```sh
gcloud auth login --no-launch-browser --update-adc --brief
```

Complete the browser flow with the intended account, then retry Secret Manager
or deploy commands. Avoid pasting secret values into terminal output; pipe them
directly into destination commands.
