import type { Book } from '@/types/book';
import type { CastaliaRepository } from './client';

const TOKEN_STORAGE_PREFIX = 'castalia:github-token:v1:';
const GITHUB_API_BASE_URL = 'https://api.github.com';

export interface GitHubRepositoryTarget {
  owner: string;
  repo: string;
}

export interface PublishCodexToGitHubInput {
  repository: CastaliaRepository;
  token: string;
  book: Book;
  file: File;
}

interface GitHubContentResponse {
  sha?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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

export const getGitHubRepositoryToken = (repositoryId: string) => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(`${TOKEN_STORAGE_PREFIX}${repositoryId}`) ?? '';
};

export const saveGitHubRepositoryToken = (repositoryId: string, token: string) => {
  if (typeof window === 'undefined') return;
  const key = `${TOKEN_STORAGE_PREFIX}${repositoryId}`;
  const trimmedToken = token.trim();
  if (trimmedToken) {
    window.localStorage.setItem(key, trimmedToken);
  } else {
    window.localStorage.removeItem(key);
  }
};

export const hasGitHubRepositoryToken = (repositoryId: string) =>
  Boolean(getGitHubRepositoryToken(repositoryId));

const encodeBase64 = async (value: File | string) => {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : new Uint8Array(await value.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const githubRequest = async <T>(path: string, token: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

const getExistingContentSha = async (
  target: GitHubRepositoryTarget,
  token: string,
  path: string,
  branch?: string,
) => {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  try {
    const content = await githubRequest<unknown>(
      `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path}${query}`,
      token,
    );
    return isRecord(content) && typeof content['sha'] === 'string' ? content['sha'] : undefined;
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) return undefined;
    throw error;
  }
};

const putRepositoryContent = async (
  target: GitHubRepositoryTarget,
  token: string,
  input: {
    path: string;
    content: File | string;
    message: string;
    branch?: string;
  },
) => {
  const sha = await getExistingContentSha(target, token, input.path, input.branch);
  const body = {
    message: input.message,
    content: await encodeBase64(input.content),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(sha ? { sha } : {}),
  };
  return githubRequest<GitHubContentResponse>(
    `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${input.path}`,
    token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
};

const createCodexMetadata = (book: Book, file: File, repository: CastaliaRepository) =>
  JSON.stringify(
    {
      schema: 'castalia.codex.github.v1',
      bookHash: book.hash,
      title: book.title,
      author: book.author,
      format: book.format,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      repository: {
        id: repository.id,
        name: repository.name,
        url: repository.url,
        branch: repository.branch,
      },
      publishedAt: new Date().toISOString(),
    },
    null,
    2,
  );

export const publishCodexToGitHub = async ({
  repository,
  token,
  book,
  file,
}: PublishCodexToGitHubInput) => {
  const target = parseGitHubRepositoryUrl(repository.url);
  if (!target) {
    throw new Error('Repository URL is not a GitHub repository');
  }

  const basePath = `codices/${book.hash}`;
  const branch = repository.branch?.trim() || undefined;
  await putRepositoryContent(target, token, {
    path: `${basePath}/book.epub`,
    content: file,
    message: `Add Codex EPUB: ${book.title}`,
    branch,
  });
  await putRepositoryContent(target, token, {
    path: `${basePath}/metadata.json`,
    content: createCodexMetadata(book, file, repository),
    message: `Add Codex metadata: ${book.title}`,
    branch,
  });
};
