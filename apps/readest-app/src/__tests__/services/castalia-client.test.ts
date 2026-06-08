import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { castaliaClient } from '@/services/castalia/client';

const user = {
  id: 'user-1',
  email: 'reader@example.com',
  user_metadata: { full_name: 'Reader One' },
} as unknown as User;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  delete window.__READEST_RUNTIME_CONFIG;
});

describe('castaliaClient', () => {
  test('reports local mode when no Castalia API URL is configured', async () => {
    const status = await castaliaClient.checkApiStatus();

    expect(status).toEqual({
      configured: false,
      reachable: false,
    });
  });

  test('checks configured Castalia API status', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          service: 'castalia',
          version: '0.1.0',
          endpoints: ['/v0/users/register', '/v0/repositories'],
          repositoryPlugins: [
            {
              id: 'castalia.repository.git',
              label: 'Castalia Git Repository',
              version: '0.1.0',
              provider: 'git',
              entrypoint: 'castalia-api',
              capabilities: ['codex-drafts:push'],
            },
          ],
        }),
      }),
    );

    const status = await castaliaClient.checkApiStatus('token-1');

    expect(fetch).toHaveBeenCalledWith(
      'https://castalia.example.com/v0/status',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
    expect(status).toMatchObject({
      configured: true,
      reachable: true,
      service: 'castalia',
      version: '0.1.0',
    });
    expect(status.repositoryPlugins).toEqual([
      expect.objectContaining({
        id: 'castalia.repository.git',
        provider: 'git',
      }),
    ]);
  });

  test('reports configured Castalia API failures', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    const status = await castaliaClient.checkApiStatus('token-1');

    expect(status).toMatchObject({
      configured: true,
      reachable: false,
      error: 'Castalia request failed: 503',
    });
  });

  test('registers a local profile when no Castalia API URL is configured', async () => {
    const profile = await castaliaClient.registerUser(user, 'token-1');

    expect(profile).toMatchObject({
      userId: 'user-1',
      email: 'reader@example.com',
      displayName: 'Reader One',
    });
    expect(castaliaClient.getState().profile).toEqual(profile);
  });

  test('ensureRegistered reuses an existing profile for the same user', async () => {
    await castaliaClient.registerUser(user, 'token-1');
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal('fetch', vi.fn());

    const profile = await castaliaClient.ensureRegistered(user, 'token-2');

    expect(profile?.userId).toBe('user-1');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('saves and selects a local repository', () => {
    const state = castaliaClient.saveRepository({
      id: 'repo-1',
      name: 'Scriptorium Drafts',
      provider: 'git',
      role: 'owner',
      url: 'https://git.example.com/repo.git',
    });

    expect(state.activeRepositoryId).toBe('repo-1');
    expect(state.repositories).toHaveLength(1);
    expect(castaliaClient.getActiveRepository()?.id).toBe('repo-1');

    const nextState = castaliaClient.setActiveRepository('repo-1');
    expect(nextState.activeRepositoryId).toBe('repo-1');
  });

  test('loads repositories from configured Castalia API', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          repositories: [{ id: 'repo-2', name: 'Codices', provider: 'castalia' }],
        }),
      }),
    );

    const repositories = await castaliaClient.listRepositories('token-1');

    expect(fetch).toHaveBeenCalledWith(
      'https://castalia.example.com/v0/repositories',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
    expect(repositories).toEqual([{ id: 'repo-2', name: 'Codices', provider: 'castalia' }]);
  });

  test('saves a repository through the configured Castalia API', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          repository: {
            id: 'repo-1',
            name: 'Scriptorium Drafts',
            provider: 'git',
            role: 'owner',
          },
        }),
      }),
    );

    const repository = await castaliaClient.saveRemoteRepository('token-1', {
      id: 'repo-1',
      name: 'Scriptorium Drafts',
      provider: 'git',
      role: 'owner',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://castalia.example.com/v0/repositories',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
    expect(repository?.id).toBe('repo-1');
  });

  test('reports repository sync capability for local and API-backed repositories', () => {
    castaliaClient.saveRepository({
      id: 'repo-1',
      name: 'Local Drafts',
      provider: 'local',
      role: 'owner',
    });

    expect(
      castaliaClient.getRepositorySyncStatus(castaliaClient.getActiveRepository()),
    ).toMatchObject({
      providerId: 'local-artifact',
      pluginId: 'castalia.repository.local-artifact',
      canPullDrafts: false,
      canPushDrafts: false,
    });

    castaliaClient.saveRepository({
      id: 'repo-2',
      name: 'Remote Drafts',
      provider: 'git',
      role: 'owner',
      url: 'https://git.example.com/repo.git',
    });
    castaliaClient.setActiveRepository('repo-2');

    expect(
      castaliaClient.getRepositorySyncStatus(castaliaClient.getActiveRepository()),
    ).toMatchObject({
      providerId: 'castalia-git',
      pluginId: 'castalia.repository.git',
      pluginCapabilities: expect.arrayContaining(['git:snapshot']),
      canPullDrafts: false,
      canPushDrafts: false,
      requiresPlugin: true,
    });

    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };

    expect(
      castaliaClient.getRepositorySyncStatus(castaliaClient.getActiveRepository()),
    ).toMatchObject({
      providerId: 'castalia-git',
      pluginId: 'castalia.repository.git',
      canPullDrafts: true,
      canPushDrafts: true,
      requiresPlugin: true,
    });
  });

  test('rejects malformed Castalia repository responses', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          repositories: [{ id: 123, title: 'Codices' }],
        }),
      }),
    );

    await expect(castaliaClient.listRepositories('token-1')).rejects.toThrow(
      'Castalia response contract mismatch',
    );
    expect(castaliaClient.getState().repositories).toEqual([]);
  });

  test('pushes Codex drafts to the active Castalia repository endpoint', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          draft: {
            repositoryId: 'repo-1',
            bookHash: 'book-1',
            sectionIndex: 1,
            html: '<p>Edited</p>',
            text: 'Edited',
            updatedAt: 1,
          },
        }),
      }),
    );

    const draft = await castaliaClient.pushCodexDraft('token-1', {
      repositoryId: 'repo-1',
      bookHash: 'book-1',
      sectionIndex: 1,
      html: '<p>Edited</p>',
      text: 'Edited',
      updatedAt: 1,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://castalia.example.com/v0/repositories/repo-1/codex-drafts',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
    expect(draft?.repositoryId).toBe('repo-1');
  });

  test('does not push repository drafts without an API-backed sync path', async () => {
    castaliaClient.saveRepository({
      id: 'repo-1',
      name: 'Scriptorium Drafts',
      provider: 'git',
      role: 'owner',
      url: 'https://git.example.com/repo.git',
    });
    vi.stubGlobal('fetch', vi.fn());

    await expect(
      castaliaClient.pushCodexDraft('token-1', {
        repositoryId: 'repo-1',
        bookHash: 'book-1',
        sectionIndex: 1,
        html: '<p>Edited</p>',
        text: 'Edited',
        updatedAt: 1,
      }),
    ).rejects.toThrow('Configure a Castalia API URL');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('pushes multiple Codex drafts through the repository endpoint', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              repositoryId: 'repo-1',
              bookHash: 'book-1',
              sectionIndex: 1,
              html: '<p>One</p>',
              text: 'One',
              syncStatus: 'pushed',
              updatedAt: 100,
              pushedAt: 110,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ draft: null }),
        }),
    );

    const drafts = await castaliaClient.pushCodexDrafts('token-1', [
      {
        repositoryId: 'repo-1',
        bookHash: 'book-1',
        sectionIndex: 1,
        html: '<p>One</p>',
        text: 'One',
        updatedAt: 1,
      },
      {
        repositoryId: 'repo-1',
        bookHash: 'book-1',
        sectionIndex: 2,
        html: '<p>Two</p>',
        text: 'Two',
        updatedAt: 2,
      },
    ]);

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      sectionIndex: 1,
      syncStatus: 'pushed',
      updatedAt: 100,
      pushedAt: 110,
    });
    expect(drafts[1]).toMatchObject({
      sectionIndex: 2,
      updatedAt: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('lists Codex drafts from a Castalia repository endpoint', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          drafts: [
            {
              repositoryId: 'repo-1',
              bookHash: 'book-1',
              sectionIndex: 1,
              html: '<p>One</p>',
              text: 'One',
              updatedAt: 1,
            },
          ],
        }),
      }),
    );

    const drafts = await castaliaClient.listCodexDrafts('token-1', 'repo-1');

    expect(fetch).toHaveBeenCalledWith(
      'https://castalia.example.com/v0/repositories/repo-1/codex-drafts',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
    expect(drafts).toHaveLength(1);
  });

  test('rejects malformed Castalia draft responses', async () => {
    window.__READEST_RUNTIME_CONFIG = {
      castaliaApiBaseUrl: 'https://castalia.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          drafts: [{ bookHash: 'book-1', sectionIndex: '1' }],
        }),
      }),
    );

    await expect(castaliaClient.listCodexDrafts('token-1', 'repo-1')).rejects.toThrow(
      'Castalia response contract mismatch',
    );
  });
});
