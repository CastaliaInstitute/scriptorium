import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { CastaliaRepository } from '@/services/castalia/client';
import {
  CROSSPOINT_CATALOG_PATH,
  CROSSPOINT_LINKS_PATH,
  CROSSPOINT_OPDS_PATH,
} from '@/services/castalia/crosspointCatalog';
import {
  parseGitHubRepositoryUrl,
  publishCodexToGitHub,
} from '@/services/castalia/githubRepository';

const book = {
  hash: 'bookhash',
  title: 'My Codex',
  author: 'Daniel',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
} as Book;

const repository: CastaliaRepository = {
  id: 'repo-1',
  name: 'Scriptorium Codices',
  url: 'https://github.com/CastaliaInstitute/codices',
  branch: 'main',
  provider: 'git',
};

const decodePutContent = (call: [unknown, RequestInit | undefined]) => {
  const body = JSON.parse(call[1]!.body as string) as Record<string, unknown>;
  return new TextDecoder().decode(
    Uint8Array.from(atob(String(body['content'])), (char) => char.charCodeAt(0)),
  );
};

describe('githubRepository', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          return new Response(JSON.stringify({ sha: 'new-sha' }), { status: 200 });
        }
        return new Response(JSON.stringify({ sha: 'old-sha' }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('parses GitHub repository URL shapes', () => {
    expect(parseGitHubRepositoryUrl('CastaliaInstitute/codices')).toEqual({
      owner: 'CastaliaInstitute',
      repo: 'codices',
    });
    expect(parseGitHubRepositoryUrl('git@github.com:CastaliaInstitute/codices.git')).toEqual({
      owner: 'CastaliaInstitute',
      repo: 'codices',
    });
    expect(parseGitHubRepositoryUrl('https://github.com/CastaliaInstitute/codices.git')).toEqual({
      owner: 'CastaliaInstitute',
      repo: 'codices',
    });
    expect(parseGitHubRepositoryUrl('https://example.com/CastaliaInstitute/codices')).toBeNull();
  });

  test('publishes EPUB and metadata through GitHub contents API', async () => {
    const file = new File(['epub bytes'], 'my-codex.epub', { type: 'application/epub+zip' });

    await publishCodexToGitHub({
      repository,
      token: 'github-token',
      book,
      file,
      crossBookLinks: [
        {
          id: 'link-1',
          rel: 'references',
          source: { bookHash: 'bookhash', href: 'chapter-1.xhtml', label: 'Chapter 1' },
          target: { bookHash: 'other-book', href: 'chapter-7.xhtml', label: 'Chapter 7' },
        },
      ],
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/book.epub?ref=main',
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/book.epub',
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/metadata.json?ref=main',
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/metadata.json',
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_CATALOG_PATH}?ref=main`,
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_LINKS_PATH}?ref=main`,
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_CATALOG_PATH}?ref=main`,
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_CATALOG_PATH}`,
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_OPDS_PATH}?ref=main`,
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_OPDS_PATH}`,
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_LINKS_PATH}?ref=main`,
      `https://api.github.com/repos/CastaliaInstitute/codices/contents/${CROSSPOINT_LINKS_PATH}`,
    ]);

    const epubPut = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as Record<
      string,
      unknown
    >;
    const metadataPut = JSON.parse(fetchMock.mock.calls[3]![1]!.body as string) as Record<
      string,
      unknown
    >;

    expect(epubPut).toMatchObject({
      branch: 'main',
      message: 'Add Codex EPUB: My Codex',
      sha: 'old-sha',
    });
    expect(metadataPut).toMatchObject({
      branch: 'main',
      message: 'Add Codex metadata: My Codex',
      sha: 'old-sha',
    });
    expect(String(metadataPut['content'])).toBeTruthy();

    const catalog = JSON.parse(
      decodePutContent(fetchMock.mock.calls[7] as [unknown, RequestInit | undefined]),
    ) as Record<string, unknown>;
    const opds = decodePutContent(fetchMock.mock.calls[9] as [unknown, RequestInit | undefined]);
    const links = JSON.parse(
      decodePutContent(fetchMock.mock.calls[11] as [unknown, RequestInit | undefined]),
    ) as Record<string, unknown>;

    expect(catalog).toMatchObject({
      schema: 'castalia.crosspoint.catalog.v1',
      repository: {
        id: 'repo-1',
        name: 'Scriptorium Codices',
      },
    });
    expect(catalog['publications']).toMatchObject([
      {
        bookHash: 'bookhash',
        title: 'My Codex',
        href: 'https://raw.githubusercontent.com/CastaliaInstitute/codices/main/codices/bookhash/book.epub',
        metadataHref:
          'https://raw.githubusercontent.com/CastaliaInstitute/codices/main/codices/bookhash/metadata.json',
        linksHref:
          'https://raw.githubusercontent.com/CastaliaInstitute/codices/main/crosspoint/links.json',
      },
    ]);
    expect(opds).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(opds).toContain('rel="http://opds-spec.org/acquisition"');
    expect(opds).toContain(
      'href="https://raw.githubusercontent.com/CastaliaInstitute/codices/main/codices/bookhash/book.epub"',
    );
    expect(links).toMatchObject({
      schema: 'castalia.crossbook-links.v1',
      links: [
        {
          id: 'link-1',
          rel: 'references',
          source: { bookHash: 'bookhash', href: 'chapter-1.xhtml', label: 'Chapter 1' },
          target: { bookHash: 'other-book', href: 'chapter-7.xhtml', label: 'Chapter 7' },
        },
      ],
    });
  });
});
