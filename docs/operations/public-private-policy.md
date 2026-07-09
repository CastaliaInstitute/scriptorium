# Public And Private Artifact Policy

Scriptorium separates source ownership, sync infrastructure, and public release
surfaces. The default posture is private unless an artifact is explicitly
promoted to a public release channel.

## Repositories

| Repository | Default Visibility | Policy |
| --- | --- | --- |
| `CastaliaInstitute/scriptorium` | Public source where possible | Reader fork, shared workflows, WebDAV service, and docs. No secrets or private sync exports. |
| `CastaliaInstitute/bibliotech` | Mixed corpus | Public-domain metadata and release automation may be public. Restricted corpus files stay private or in private buckets. |
| `AtelierNymphet/AtelierNymphet` | Private manuscripts | Source manuscripts, generated private EPUBs, source maps, and review artifacts remain private by default. |

## Storage Surfaces

The first deployed WebDAV/OPDS backend is a private Supabase Storage bucket:

```text
readest
```

It is used for authenticated Readest sync and review workflows, not as the
public release surface. Root prefixes identify ownership and policy:

```text
Bibliotech/
La Recherche/
Twenty Dollar Words/
Readest/
```

`Readest/` is reserved for app sync JSON and user library state. Source
repository publishers should use their top-level collection prefixes.

## Bibliotech

Bibliotech can contain public-domain books, licensed research files, and private
working artifacts. Use these rules:

- Public-domain EPUBs may be published under `Bibliotech/` for authenticated
  Readest sync.
- A separate public bucket, GitHub Release, or Pages/OPDS surface should be used
  for open public distribution.
- Restricted or uncertain-rights corpus files must not be copied to public
  release surfaces.
- Generated indexes or metadata can be public only if they do not expose private
  source text or restricted file locations.

The current `readest` bucket stays private even when it contains public-domain
books. Promotion to public distribution is a separate release step.

## AtelierNymphet

AtelierNymphet artifacts are private by default:

- La Recherche source EPUBs
- Twenty Dollar Words source EPUBs
- source maps
- RAG manifests
- Readest annotation exports
- AI issue summaries
- source-edit proposal artifacts

Do not publish these artifacts to a public OPDS feed, public bucket, or public
GitHub release unless the owning repository explicitly promotes that edition.

## Review Artifacts

Review artifacts may contain private manuscript text, private annotations,
reader context, and AI-generated source diffs. Treat these as private:

```text
.atelier/readest-review/
.atelier/readest-edit-proposals/
output/readest/
```

GitHub issues created from annotations should land in the source repository when
that repository is private and owns the manuscript. If a public repository is
used for coordination, issue bodies must avoid private source excerpts unless
the excerpt is cleared for that audience.

## Secrets

Never commit or print:

- Supabase service-role keys
- Gemini API keys
- WebDAV passwords
- GitHub tokens
- Readest sync JSON
- private source maps or annotation exports

Use GitHub Secrets, Google Secret Manager, or local ignored `.env` files.

## Promotion Checklist

Before promoting any artifact to a public surface:

1. Confirm the source repository owner approves the release.
2. Confirm rights status for the text and cover art.
3. Strip private annotations, source maps, review notes, and AI proposal data.
4. Rebuild the EPUB from canonical source.
5. Verify metadata and cover art.
6. Publish to the intended public surface, not the private Readest sync bucket.
7. Keep a private sync copy only if reader devices still need it.
