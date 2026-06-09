import type { Book } from '@/types/book';
import type { CastaliaRepository } from './client';

export const CASTALIA_CROSSPOINT_CATALOG_SCHEMA = 'castalia.crosspoint.catalog.v1';
export const CASTALIA_CROSSBOOK_LINKS_SCHEMA = 'castalia.crossbook-links.v1';

export const CROSSPOINT_CATALOG_PATH = 'crosspoint/catalog.json';
export const CROSSPOINT_OPDS_PATH = 'crosspoint/opds.xml';
export const CROSSPOINT_LINKS_PATH = 'crosspoint/links.json';

export interface CrossPointPublication {
  id: string;
  bookHash: string;
  title: string;
  authors: string[];
  format: string;
  mediaType: string;
  size: number;
  fileName: string;
  href: string;
  metadataHref: string;
  linksHref: string;
  updatedAt: string;
}

export interface CrossPointCatalog {
  schema: typeof CASTALIA_CROSSPOINT_CATALOG_SCHEMA;
  updatedAt: string;
  repository: {
    id: string;
    name: string;
    url?: string;
    branch?: string;
  };
  publications: CrossPointPublication[];
}

export interface CrossBookLocation {
  bookHash: string;
  href?: string;
  cfi?: string;
  fragment?: string;
  label?: string;
}

export interface CrossBookLink {
  id: string;
  rel: string;
  title?: string;
  source: CrossBookLocation;
  target: CrossBookLocation;
  createdAt?: string;
  updatedAt?: string;
}

export interface CrossBookLinkManifest {
  schema: typeof CASTALIA_CROSSBOOK_LINKS_SCHEMA;
  updatedAt: string;
  repository: {
    id: string;
    name: string;
  };
  links: CrossBookLink[];
}

const EPUB_MEDIA_TYPE = 'application/epub+zip';

const sortPublications = (publications: CrossPointPublication[]) =>
  [...publications].sort((a, b) => {
    const title = a.title.localeCompare(b.title);
    if (title !== 0) return title;
    return a.bookHash.localeCompare(b.bookHash);
  });

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export const createCrossPointPublication = (
  book: Book,
  file: File,
  input: {
    bookHref: string;
    metadataHref: string;
    linksHref: string;
    publishedAt: string;
  },
): CrossPointPublication => ({
  id: `urn:castalia:codex:${book.hash}`,
  bookHash: book.hash,
  title: book.title || file.name.replace(/\.epub$/i, '') || book.hash,
  authors: book.author ? [book.author] : [],
  format: book.format,
  mediaType: file.type || EPUB_MEDIA_TYPE,
  size: file.size,
  fileName: file.name,
  href: input.bookHref,
  metadataHref: input.metadataHref,
  linksHref: input.linksHref,
  updatedAt: input.publishedAt,
});

export const createCrossPointCatalog = (
  repository: CastaliaRepository,
  publications: CrossPointPublication[],
  updatedAt = new Date().toISOString(),
): CrossPointCatalog => ({
  schema: CASTALIA_CROSSPOINT_CATALOG_SCHEMA,
  updatedAt,
  repository: {
    id: repository.id,
    name: repository.name,
    ...(repository.url ? { url: repository.url } : {}),
    ...(repository.branch ? { branch: repository.branch } : {}),
  },
  publications: sortPublications(publications),
});

export const mergeCrossPointCatalogPublication = (
  catalog: CrossPointCatalog | null,
  repository: CastaliaRepository,
  publication: CrossPointPublication,
  updatedAt = publication.updatedAt,
): CrossPointCatalog => {
  const publications = (catalog?.publications ?? []).filter(
    (entry) => entry.bookHash !== publication.bookHash,
  );
  publications.push(publication);
  return createCrossPointCatalog(repository, publications, updatedAt);
};

export const createCrossBookLinkManifest = (
  repository: CastaliaRepository,
  links: CrossBookLink[] = [],
  updatedAt = new Date().toISOString(),
): CrossBookLinkManifest => ({
  schema: CASTALIA_CROSSBOOK_LINKS_SCHEMA,
  updatedAt,
  repository: {
    id: repository.id,
    name: repository.name,
  },
  links: [...links].sort((a, b) => a.id.localeCompare(b.id)),
});

export const serializeCrossPointCatalog = (catalog: CrossPointCatalog) =>
  JSON.stringify(catalog, null, 2);

export const serializeCrossBookLinkManifest = (manifest: CrossBookLinkManifest) =>
  JSON.stringify(manifest, null, 2);

export const serializeCrossPointOpdsCatalog = (catalog: CrossPointCatalog) => {
  const entries = catalog.publications
    .map((publication) => {
      const authors = publication.authors.length ? publication.authors : ['Unknown'];
      const authorXml = authors
        .map((author) => `<author><name>${escapeXml(author)}</name></author>`)
        .join('');
      return [
        '<entry>',
        `<title>${escapeXml(publication.title)}</title>`,
        `<id>${escapeXml(publication.id)}</id>`,
        `<updated>${escapeXml(publication.updatedAt)}</updated>`,
        authorXml,
        `<link rel="http://opds-spec.org/acquisition" type="${escapeXml(
          publication.mediaType || EPUB_MEDIA_TYPE,
        )}" href="${escapeXml(publication.href)}" />`,
        `<link rel="alternate" type="application/json" href="${escapeXml(publication.metadataHref)}" />`,
        '</entry>',
      ].join('');
    })
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${escapeXml(catalog.repository.name)} CrossPoint Catalog</title>`,
    `<id>urn:castalia:crosspoint:${escapeXml(catalog.repository.id)}</id>`,
    `<updated>${escapeXml(catalog.updatedAt)}</updated>`,
    entries,
    '</feed>',
  ].join('');
};
