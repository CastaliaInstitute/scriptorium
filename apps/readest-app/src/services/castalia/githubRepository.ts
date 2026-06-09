import type { Book } from '@/types/book';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import type { CastaliaRepository } from './client';
import type { CrossBookLink } from './crosspointCatalog';

const CASTALIA_GITHUB_FUNCTION = 'castalia-github-repository';

export interface GitHubRepositoryTarget {
  owner: string;
  repo: string;
}

export interface PublishCodexToGitHubInput {
  repository: CastaliaRepository;
  token: string;
  book: Book;
  file: File;
  crossBookLinks?: CrossBookLink[];
}

const normalizeRepoUrl = (value: string) => value.trim().replace(/\.git$/i, '');

export const parseGitHubRepositoryUrl = (value?: string): GitHubRepositoryTarget | null => {
  if (!value) return null;
  const normalized = normalizeRepoUrl(value);

  const shorthand = normalized.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    return { owner: shorthand[1]!, repo: shorthand[2]! };
  }

  const ssh = normalized.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i);
  if (ssh) {
    return { owner: ssh[1]!, repo: ssh[2]! };
  }

  try {
    const url = new URL(normalized);
    if (url.hostname !== 'github.com') return null;
    const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
};

const getSupabaseUrl = () =>
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'];

export const getCastaliaGitHubFunctionUrl = () => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) return '';
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${CASTALIA_GITHUB_FUNCTION}`;
};

const encodeBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const getBookPayload = (book: Book) => ({
  hash: book.hash,
  title: book.title,
  author: book.author,
  format: book.format,
  createdAt: book.createdAt,
  updatedAt: book.updatedAt,
});

export const publishCodexToGitHub = async ({
  repository,
  token,
  book,
  file,
  crossBookLinks,
}: PublishCodexToGitHubInput) => {
  if (!parseGitHubRepositoryUrl(repository.url)) {
    throw new Error('Repository URL is not a GitHub repository');
  }

  const functionUrl = getCastaliaGitHubFunctionUrl();
  if (!functionUrl) {
    throw new Error('Castalia Supabase is not configured for GitHub repository access');
  }

  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'publish-codex',
      repository,
      book: getBookPayload(book),
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
        contentBase64: await encodeBase64(file),
      },
      crossBookLinks: crossBookLinks ?? [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Castalia GitHub publish failed: ${response.status}`);
  }

  return (await response.json()) as unknown;
};
