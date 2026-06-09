import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { CastaliaRepository } from '@/services/castalia/client';
import {
  getCastaliaGitHubFunctionUrl,
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
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://pilmscrodlitdrygabvo.supabase.co';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  afterEach(() => {
    delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
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

  test('resolves Castalia Supabase GitHub function URL', () => {
    expect(getCastaliaGitHubFunctionUrl()).toBe(
      'https://pilmscrodlitdrygabvo.supabase.co/functions/v1/castalia-github-repository',
    );
  });

  test('publishes EPUB through Castalia Supabase GitHub function', async () => {
    const file = new File(['epub bytes'], 'my-codex.epub', { type: 'application/epub+zip' });

    await publishCodexToGitHub({
      repository,
      token: 'castalia-supabase-token',
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://pilmscrodlitdrygabvo.supabase.co/functions/v1/castalia-github-repository',
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer castalia-supabase-token',
        'Content-Type': 'application/json',
      },
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      action: 'publish-codex',
      repository: {
        id: 'repo-1',
        name: 'Scriptorium Codices',
      },
      book: {
        hash: 'bookhash',
        title: 'My Codex',
      },
      file: {
        name: 'my-codex.epub',
        type: 'application/epub+zip',
        size: 10,
        contentBase64: 'ZXB1YiBieXRlcw==',
      },
      crossBookLinks: [
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
