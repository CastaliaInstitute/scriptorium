# Scriptorium OPDS/WebDAV/Supabase Integration

Scriptorium is the authoring and marginalia layer on top of the Readest fork.
It does not own every EPUB source. Source repositories publish built EPUB
artifacts into a shared WebDAV endpoint backed by Supabase Storage, and the
endpoint exposes the same files through an OPDS acquisition catalog.

## Repository Roles

- `CastaliaInstitute/scriptorium`: Readest fork, annotation workflow, shared
  WebDAV service, reusable GitHub Actions.
- `CastaliaInstitute/bibliotech`: Castalia library corpus, including Gutenberg
  and other library EPUBs.
- `AtelierNymphet/AtelierNymphet`: manuscript source and generated EPUBs for
  La Recherche and Twenty Dollar Words.

## WebDAV Service

The Cloud Run service lives in `tools/readest-webdav-cloudrun`.

It supports:

- Supabase Storage backend with bucket `readest` by default.
- Google Cloud Run scale-to-zero deployment.
- WebDAV methods used by Readest.
- OPDS catalog at `/opds`.
- Root-level collection folders such as `Bibliotech`, `La Recherche`, and
  `Twenty Dollar Words`.

Deploy from Scriptorium with the `Deploy Scriptorium WebDAV` workflow or run:

```sh
cd tools/readest-webdav-cloudrun
./deploy.sh
```

Required Google Secret Manager entries for the default Supabase backend:

```text
supabase-url
supabase-service-role-key
readest-webdav-password
```

Required GitHub secrets for the deploy workflow:

```text
GCP_SERVICE_ACCOUNT_JSON
```

## Publishing EPUBs

Reusable workflow:

```text
CastaliaInstitute/scriptorium/.github/workflows/sync-epubs-to-webdav.yml@main
```

Required caller secrets:

```text
READEST_WEBDAV_URL
READEST_WEBDAV_USERNAME
READEST_WEBDAV_PASSWORD
```

Current caller prefixes:

- Bibliotech publishes to `Bibliotech`.
- AtelierNymphet La Recherche publishes to `La Recherche`.
- AtelierNymphet Twenty Dollar Words publishes to `Twenty Dollar Words`.

## Annotation Review

Reusable workflow:

```text
CastaliaInstitute/scriptorium/.github/workflows/readest-comments-to-issues.yml@main
```

It downloads Readest `library.json` and `config.json` files from WebDAV, maps
annotations to the caller repository source map, and creates GitHub issues with
Gemini summaries. If the source map is generated, pass
`source_map_build_command` so the caller repository builds it before annotation
ingest. The build step receives `GH_TOKEN`, backed by optional
`SOURCE_REPO_TOKEN`, for workflows that need to clone private source repos.

Readest commonly stores sync data beneath a `Readest/` directory. The shared
ingest script autodetects that nested folder when the workflow scans the WebDAV
root.

Additional optional secret:

```text
GEMINI_API_KEY
```

Optional variable:

```text
GEMINI_READEST_ISSUE_MODEL
```

## Readest Auto-Refresh

Scriptorium's Readest fork includes `bookFileRefresh`, which redownloads an
already-synced EPUB when the remote synced book has a newer `uploadedAt` value
or a changed `metaHash`. This is what makes an updated `Absinthe.epub` propagate
to devices after sync instead of requiring manual delete/reimport.
