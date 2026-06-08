import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET as getStatus } from '@/app/api/castalia/v0/status/route';
import {
  GET as getRepositories,
  PUT as putRepository,
} from '@/app/api/castalia/v0/repositories/route';
import { POST as registerUser } from '@/app/api/castalia/v0/users/register/route';
import {
  GET as getDrafts,
  PUT as putDraft,
} from '@/app/api/castalia/v0/repositories/[repositoryId]/codex-drafts/route';
import { castaliaServerStore } from '@/services/castalia/serverStore';
import { createSupabaseAdminClient } from '@/utils/supabase';

const user = {
  id: 'user-1',
  email: 'reader@example.com',
  user_metadata: { full_name: 'Reader One' },
} as unknown as User;

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async (token: string) => ({
        data: { user: token === 'token-1' ? user : null },
        error: token === 'token-1' ? null : { message: 'invalid token' },
      })),
    },
  },
  createSupabaseAdminClient: vi.fn(),
}));

const authHeaders = {
  Authorization: 'Bearer token-1',
  'Content-Type': 'application/json',
};

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify(body),
  });

beforeEach(() => {
  process.env['CASTALIA_SERVER_STORE'] = 'memory';
  delete process.env['SUPABASE_ADMIN_KEY'];
  castaliaServerStore.reset();
  vi.mocked(createSupabaseAdminClient).mockReset();
});

describe('/api/castalia/v0', () => {
  test('reports the Castalia v0 contract', async () => {
    const response = await getStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      service: 'castalia-scriptorium',
      version: '0.1.0',
    });
    expect(data.endpoints).toContain('/v0/repositories/:repositoryId/codex-drafts');
    expect(data.repositoryPlugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'castalia.repository.git',
          provider: 'git',
          entrypoint: 'castalia-api',
        }),
        expect.objectContaining({
          id: 'castalia.repository.local-artifact',
          provider: 'local',
          entrypoint: 'local-artifact',
        }),
      ]),
    );
  });

  test('requires authentication for registration', async () => {
    const response = await registerUser(
      new Request('http://localhost/api/castalia/v0/users/register', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
  });

  test('registers a user and exposes a default repository', async () => {
    const registerResponse = await registerUser(
      new Request('http://localhost/api/castalia/v0/users/register', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ displayName: 'Reader One' }),
      }),
    );
    const registerData = await registerResponse.json();

    expect(registerResponse.status).toBe(200);
    expect(registerData.profile).toMatchObject({
      userId: 'user-1',
      email: 'reader@example.com',
      displayName: 'Reader One',
    });

    const repositoriesResponse = await getRepositories(
      new Request('http://localhost/api/castalia/v0/repositories', {
        headers: authHeaders,
      }),
    );
    const repositoriesData = await repositoriesResponse.json();

    expect(repositoriesResponse.status).toBe(200);
    expect(repositoriesData.repositories).toEqual([
      expect.objectContaining({
        id: 'castalia-user-1',
        name: 'Scriptorium Codices',
        provider: 'castalia',
      }),
    ]);
  });

  test('saves repositories and round-trips Codex drafts', async () => {
    const repositoryResponse = await putRepository(
      jsonRequest('http://localhost/api/castalia/v0/repositories', {
        id: 'repo-1',
        name: 'Scriptorium Drafts',
        provider: 'git',
        role: 'owner',
      }),
    );
    const repositoryData = await repositoryResponse.json();

    expect(repositoryResponse.status).toBe(200);
    expect(repositoryData.repository).toMatchObject({
      id: 'repo-1',
      provider: 'git',
    });

    const context = { params: Promise.resolve({ repositoryId: 'repo-1' }) };
    const draftResponse = await putDraft(
      jsonRequest('http://localhost/api/castalia/v0/repositories/repo-1/codex-drafts', {
        draft: {
          repositoryId: 'repo-1',
          bookHash: 'book-1',
          sectionIndex: 1,
          html: '<p>Edited</p>',
          text: 'Edited',
          updatedAt: 1,
        },
      }),
      context,
    );
    const draftData = await draftResponse.json();

    expect(draftResponse.status).toBe(200);
    expect(draftData.draft).toMatchObject({
      repositoryId: 'repo-1',
      syncStatus: 'pushed',
    });

    const draftsResponse = await getDrafts(
      new Request('http://localhost/api/castalia/v0/repositories/repo-1/codex-drafts', {
        headers: authHeaders,
      }),
      context,
    );
    const draftsData = await draftsResponse.json();

    expect(draftsResponse.status).toBe(200);
    expect(draftsData.drafts).toHaveLength(1);
    expect(draftsData.drafts[0].text).toBe('Edited');
  });

  test('rejects invalid Codex draft payloads', async () => {
    const response = await putDraft(
      jsonRequest('http://localhost/api/castalia/v0/repositories/repo-1/codex-drafts', {
        draft: {
          bookHash: 'book-1',
          sectionIndex: 'bad',
        },
      }),
      { params: Promise.resolve({ repositoryId: 'repo-1' }) },
    );

    expect(response.status).toBe(400);
  });

  test('falls back to memory storage when the Supabase Castalia tables are unavailable', async () => {
    process.env['CASTALIA_SERVER_STORE'] = 'supabase';
    process.env['SUPABASE_ADMIN_KEY'] = 'service-role';
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn(() => {
          throw new Error('relation "castalia_profiles" does not exist');
        }),
      })),
    } as never);

    const profile = await castaliaServerStore.registerUser(user, {
      displayName: 'Reader One',
    });

    expect(profile).toMatchObject({
      userId: 'user-1',
      displayName: 'Reader One',
    });
    expect(await castaliaServerStore.listRepositories(user)).toEqual([
      expect.objectContaining({
        id: 'castalia-user-1',
      }),
    ]);
  });
});
