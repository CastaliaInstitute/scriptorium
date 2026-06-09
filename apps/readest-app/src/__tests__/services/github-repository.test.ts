import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { CastaliaRepository } from '@/services/castalia/client';
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
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/book.epub?ref=main',
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/book.epub',
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/metadata.json?ref=main',
      'https://api.github.com/repos/CastaliaInstitute/codices/contents/codices/bookhash/metadata.json',
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
  });
});
