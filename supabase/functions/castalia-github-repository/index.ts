import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const CASTALIA_CROSSPOINT_CATALOG_SCHEMA = 'castalia.crosspoint.catalog.v1';
const CASTALIA_CROSSBOOK_LINKS_SCHEMA = 'castalia.crossbook-links.v1';
const CROSSPOINT_CATALOG_PATH = 'crosspoint/catalog.json';
const CROSSPOINT_OPDS_PATH = 'crosspoint/opds.xml';
const CROSSPOINT_LINKS_PATH = 'crosspoint/links.json';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CastaliaRepository {
  id: string;
  name: string;
  url?: string;
  branch?: string;
}

interface BookPayload {
  hash: string;
  title?: string;
  author?: string;
  format?: string;
}

interface FilePayload {
  name: string;
  type?: string;
  size: number;
  contentBase64: string;
}

interface CrossBookLocation {
  bookHash: string;
  href?: string;
  cfi?: string;
  fragment?: string;
  label?: string;
}

interface CrossBookLink {
  id: string;
  rel: string;
  title?: string;
  source: CrossBookLocation;
  target: CrossBookLocation;
  createdAt?: string;
  updatedAt?: string;
}

interface CrossPointPublication {
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

interface CrossPointCatalog {
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

interface CrossBookLinkManifest {
  schema: typeof CASTALIA_CROSSBOOK_LINKS_SCHEMA;
  updatedAt: string;
  repository: {
    id: string;
    name: string;
  };
  links: CrossBookLink[];
}

interface GitHubRepositoryTarget {
  owner: string;
  repo: string;
}

interface GitHubContentResponse {
  sha?: string;
  content?: string;
  encoding?: string;
}

interface PublishRequest {
  action: 'publish-codex';
  repository: CastaliaRepository;
  book: BookPayload;
  file: FilePayload;
  crossBookLinks?: CrossBookLink[];
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const normalizeRepoUrl = (value: string) => value.trim().replace(/\.git$/i, '');

const parseGitHubRepositoryUrl = (value?: string): GitHubRepositoryTarget | null => {
  if (!value) return null;
  const normalized = normalizeRepoUrl(value);
  const shorthand = normalized.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) return { owner: shorthand[1]!, repo: shorthand[2]! };
  const ssh = normalized.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  try {
    const url = new URL(normalized);
    if (url.hostname !== 'github.com') return null;
    const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
};

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const encodeRawGitHubPath = (path: string) =>
  path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

const getRawGitHubUrl = (target: GitHubRepositoryTarget, branch: string, path: string) =>
  `https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(
    target.repo,
  )}/${encodeURIComponent(branch)}/${encodeRawGitHubPath(path)}`;

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
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
  return (await response.json()) as T;
};

const requireAuthenticatedUser = async (authHeader: string) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase auth is not configured');
  }
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: authHeader,
    },
  });
  if (!response.ok) throw new Error('Unauthorized');
  const user = (await response.json()) as unknown;
  if (!isRecord(user) || typeof user['id'] !== 'string') throw new Error('Unauthorized');
  return user;
};

const decodeBase64Text = (value: string) => {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const getRepositoryTextContent = async (
  target: GitHubRepositoryTarget,
  token: string,
  path: string,
  branch?: string,
) => {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  try {
    const content = await githubRequest<GitHubContentResponse>(
      `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path}${query}`,
      token,
    );
    if (content.encoding !== 'base64' || typeof content.content !== 'string') return null;
    return decodeBase64Text(content.content);
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) return null;
    throw error;
  }
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
    contentBase64: string;
    message: string;
    branch?: string;
  },
) => {
  const sha = await getExistingContentSha(target, token, input.path, input.branch);
  return githubRequest<GitHubContentResponse>(
    `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${input.path}`,
    token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: input.message,
        content: input.contentBase64,
        ...(input.branch ? { branch: input.branch } : {}),
        ...(sha ? { sha } : {}),
      }),
    },
  );
};

const encodeTextBase64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const parseCrossPointCatalog = (raw: string | null): CrossPointCatalog | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed['schema'] !== CASTALIA_CROSSPOINT_CATALOG_SCHEMA) return null;
    const repository = parsed['repository'];
    const publications = parsed['publications'];
    if (!isRecord(repository) || !Array.isArray(publications)) return null;
    const repositoryId = asString(repository['id']);
    const repositoryName = asString(repository['name']);
    if (!repositoryId || !repositoryName) return null;
    return {
      schema: CASTALIA_CROSSPOINT_CATALOG_SCHEMA,
      updatedAt: asString(parsed['updatedAt']) ?? new Date().toISOString(),
      repository: {
        id: repositoryId,
        name: repositoryName,
        url: asString(repository['url']),
        branch: asString(repository['branch']),
      },
      publications: publications.filter(isRecord).map((publication) => ({
        id: asString(publication['id']) ?? '',
        bookHash: asString(publication['bookHash']) ?? '',
        title: asString(publication['title']) ?? '',
        authors: Array.isArray(publication['authors'])
          ? publication['authors'].filter((item): item is string => typeof item === 'string')
          : [],
        format: asString(publication['format']) ?? 'EPUB',
        mediaType: asString(publication['mediaType']) ?? 'application/epub+zip',
        size: typeof publication['size'] === 'number' ? publication['size'] : 0,
        fileName: asString(publication['fileName']) ?? '',
        href: asString(publication['href']) ?? '',
        metadataHref: asString(publication['metadataHref']) ?? '',
        linksHref: asString(publication['linksHref']) ?? '',
        updatedAt: asString(publication['updatedAt']) ?? new Date().toISOString(),
      })),
    };
  } catch {
    return null;
  }
};

const parseCrossBookLinkManifest = (
  raw: string | null,
  repository: CastaliaRepository,
): CrossBookLinkManifest => {
  if (!raw) {
    return {
      schema: CASTALIA_CROSSBOOK_LINKS_SCHEMA,
      updatedAt: new Date().toISOString(),
      repository: { id: repository.id, name: repository.name },
      links: [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const links =
      isRecord(parsed) &&
      parsed['schema'] === CASTALIA_CROSSBOOK_LINKS_SCHEMA &&
      Array.isArray(parsed['links'])
        ? parsed['links'].filter(isRecord)
        : [];
    return {
      schema: CASTALIA_CROSSBOOK_LINKS_SCHEMA,
      updatedAt: new Date().toISOString(),
      repository: { id: repository.id, name: repository.name },
      links: links as unknown as CrossBookLink[],
    };
  } catch {
    return {
      schema: CASTALIA_CROSSBOOK_LINKS_SCHEMA,
      updatedAt: new Date().toISOString(),
      repository: { id: repository.id, name: repository.name },
      links: [],
    };
  }
};

const serializeOpds = (catalog: CrossPointCatalog) => {
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
          publication.mediaType,
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

const publishCodex = async (input: PublishRequest, githubToken: string) => {
  const target = parseGitHubRepositoryUrl(input.repository.url);
  if (!target) throw new Error('Repository URL is not a GitHub repository');
  const branch = input.repository.branch?.trim() || undefined;
  const rawBranch = branch ?? 'main';
  const publishedAt = new Date().toISOString();
  const basePath = `codices/${input.book.hash}`;
  const bookPath = `${basePath}/book.epub`;
  const metadataPath = `${basePath}/metadata.json`;

  await putRepositoryContent(target, githubToken, {
    path: bookPath,
    contentBase64: input.file.contentBase64,
    message: `Add Codex EPUB: ${input.book.title ?? input.file.name}`,
    branch,
  });

  const metadata = {
    schema: 'castalia.codex.github.v1',
    bookHash: input.book.hash,
    title: input.book.title,
    author: input.book.author,
    format: input.book.format,
    fileName: input.file.name,
    fileType: input.file.type,
    fileSize: input.file.size,
    repository: input.repository,
    publishedAt,
  };
  await putRepositoryContent(target, githubToken, {
    path: metadataPath,
    contentBase64: encodeTextBase64(JSON.stringify(metadata, null, 2)),
    message: `Add Codex metadata: ${input.book.title ?? input.file.name}`,
    branch,
  });

  const existingCatalog = parseCrossPointCatalog(
    await getRepositoryTextContent(target, githubToken, CROSSPOINT_CATALOG_PATH, branch),
  );
  const existingLinks = parseCrossBookLinkManifest(
    await getRepositoryTextContent(target, githubToken, CROSSPOINT_LINKS_PATH, branch),
    input.repository,
  );
  const publication: CrossPointPublication = {
    id: `urn:castalia:codex:${input.book.hash}`,
    bookHash: input.book.hash,
    title: input.book.title || input.file.name.replace(/\.epub$/i, '') || input.book.hash,
    authors: input.book.author ? [input.book.author] : [],
    format: input.book.format ?? 'EPUB',
    mediaType: input.file.type || 'application/epub+zip',
    size: input.file.size,
    fileName: input.file.name,
    href: getRawGitHubUrl(target, rawBranch, bookPath),
    metadataHref: getRawGitHubUrl(target, rawBranch, metadataPath),
    linksHref: getRawGitHubUrl(target, rawBranch, CROSSPOINT_LINKS_PATH),
    updatedAt: publishedAt,
  };
  const publications = (existingCatalog?.publications ?? []).filter(
    (entry) => entry.bookHash !== publication.bookHash,
  );
  publications.push(publication);
  publications.sort(
    (a, b) => a.title.localeCompare(b.title) || a.bookHash.localeCompare(b.bookHash),
  );
  const catalog: CrossPointCatalog = {
    schema: CASTALIA_CROSSPOINT_CATALOG_SCHEMA,
    updatedAt: publishedAt,
    repository: {
      id: input.repository.id,
      name: input.repository.name,
      url: input.repository.url,
      branch: input.repository.branch,
    },
    publications,
  };
  const mergedLinks = new Map(existingLinks.links.map((link) => [link.id, link]));
  for (const link of input.crossBookLinks ?? []) mergedLinks.set(link.id, link);
  const links: CrossBookLinkManifest = {
    schema: CASTALIA_CROSSBOOK_LINKS_SCHEMA,
    updatedAt: publishedAt,
    repository: { id: input.repository.id, name: input.repository.name },
    links: [...mergedLinks.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };

  await putRepositoryContent(target, githubToken, {
    path: CROSSPOINT_CATALOG_PATH,
    contentBase64: encodeTextBase64(JSON.stringify(catalog, null, 2)),
    message: `Update CrossPoint catalog: ${input.repository.name}`,
    branch,
  });
  await putRepositoryContent(target, githubToken, {
    path: CROSSPOINT_OPDS_PATH,
    contentBase64: encodeTextBase64(serializeOpds(catalog)),
    message: `Update CrossPoint OPDS feed: ${input.repository.name}`,
    branch,
  });
  await putRepositoryContent(target, githubToken, {
    path: CROSSPOINT_LINKS_PATH,
    contentBase64: encodeTextBase64(JSON.stringify(links, null, 2)),
    message: `Update CrossPoint links: ${input.repository.name}`,
    branch,
  });

  return { ok: true, publishedAt, repository: input.repository, bookHash: input.book.hash };
};

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'Unauthorized' }, 401);
  const githubToken =
    Deno.env.get('CASTALIA_GITHUB_TOKEN') ||
    Deno.env.get('COMMONPLACE_GITHUB_TOKEN') ||
    Deno.env.get('FAMILY_RHYTHM_GITHUB_TOKEN') ||
    Deno.env.get('GITHUB_TOKEN');
  if (!githubToken) return jsonResponse({ error: 'GitHub access is not configured' }, 503);

  try {
    await requireAuthenticatedUser(authHeader);
    const input = (await request.json()) as PublishRequest;
    if (input.action !== 'publish-codex') return jsonResponse({ error: 'Unknown action' }, 400);
    if (!input.repository?.id || !input.book?.hash || !input.file?.contentBase64) {
      return jsonResponse({ error: 'Invalid publish request' }, 400);
    }
    return jsonResponse(await publishCodex(input, githubToken));
  } catch (error) {
    console.error('Castalia GitHub function failed:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Castalia GitHub function failed' },
      500,
    );
  }
});
