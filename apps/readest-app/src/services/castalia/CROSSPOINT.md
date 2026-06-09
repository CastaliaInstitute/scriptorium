# CrossPoint GitHub Repository Contract

Scriptorium publishes CrossPoint-facing artifacts into connected GitHub repositories when a
Castalia EPUB is published.

## Files

- `codices/<bookHash>/book.epub`: downloadable Castalia EPUB.
- `codices/<bookHash>/metadata.json`: Scriptorium metadata for the EPUB.
- `crosspoint/catalog.json`: JSON catalog for lightweight clients.
- `crosspoint/opds.xml`: OPDS 1.2 Atom feed for CrossPoint's existing OPDS browser.
- `crosspoint/links.json`: cross-book link manifest.

For public repositories, CrossPoint can use the raw GitHub URL for `crosspoint/opds.xml` as an
OPDS catalog URL. Private repositories require a proxy or future authenticated GitHub support on
the device.

## Catalog

`crosspoint/catalog.json` uses schema `castalia.crosspoint.catalog.v1`.

```json
{
  "schema": "castalia.crosspoint.catalog.v1",
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "repository": {
    "id": "repo-1",
    "name": "Scriptorium Codices",
    "url": "https://github.com/CastaliaInstitute/codices",
    "branch": "main"
  },
  "publications": [
    {
      "id": "urn:castalia:codex:bookhash",
      "bookHash": "bookhash",
      "title": "My Codex",
      "authors": ["Author"],
      "format": "EPUB",
      "mediaType": "application/epub+zip",
      "size": 12345,
      "fileName": "my-codex.epub",
      "href": "https://raw.githubusercontent.com/.../codices/bookhash/book.epub",
      "metadataHref": "https://raw.githubusercontent.com/.../codices/bookhash/metadata.json",
      "linksHref": "https://raw.githubusercontent.com/.../crosspoint/links.json",
      "updatedAt": "2026-06-09T00:00:00.000Z"
    }
  ]
}
```

## Cross-Book Links

`crosspoint/links.json` uses schema `castalia.crossbook-links.v1`.

```json
{
  "schema": "castalia.crossbook-links.v1",
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "repository": {
    "id": "repo-1",
    "name": "Scriptorium Codices"
  },
  "links": [
    {
      "id": "link-1",
      "rel": "references",
      "title": "Shared image",
      "source": {
        "bookHash": "source-book",
        "href": "chapter-1.xhtml",
        "label": "Chapter 1"
      },
      "target": {
        "bookHash": "target-book",
        "href": "chapter-7.xhtml",
        "label": "Chapter 7"
      },
      "createdAt": "2026-06-09T00:00:00.000Z",
      "updatedAt": "2026-06-09T00:00:00.000Z"
    }
  ]
}
```

CrossPoint should resolve `bookHash` through `crosspoint/catalog.json`, then open the matching
downloaded EPUB. If `href` exists, use it as the preferred internal section target. If future
entries include `cfi`, prefer `cfi` for precise passage navigation.
