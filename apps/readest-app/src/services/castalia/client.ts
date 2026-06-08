import type { User } from '@supabase/supabase-js';
import { z } from 'zod';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import type { CodexDraft } from './codexDrafts';
import { getCastaliaRepositoryProvider } from './repositoryProviders';
import type {
  CastaliaRepositoryPluginManifest,
  CastaliaRepositoryProviderKind,
} from './repositoryProviders';

const STORAGE_KEY = 'castalia:repository-state:v1';

export interface CastaliaProfile {
  userId: string;
  email?: string;
  displayName?: string;
  registeredAt: number;
}

export interface CastaliaRepository {
  id: string;
  name: string;
  url?: string;
  branch?: string;
  provider?: CastaliaRepositoryProviderKind;
  role?: 'owner' | 'editor' | 'reader';
  updatedAt?: number;
}

export interface CastaliaRepositoryState {
  profile?: CastaliaProfile;
  repositories: CastaliaRepository[];
  activeRepositoryId?: string;
}

export interface CastaliaApiStatus {
  configured: boolean;
  reachable: boolean;
  baseUrl?: string;
  service?: string;
  version?: string;
  endpoints?: string[];
  repositoryPlugins?: CastaliaRepositoryPluginManifest[];
  error?: string;
}

export interface CastaliaRepositorySyncStatus {
  providerId: string;
  providerLabel: string;
  canPullDrafts: boolean;
  canPushDrafts: boolean;
  mode: 'castalia-api' | 'local-artifact';
  pluginId: string;
  pluginVersion: string;
  pluginCapabilities: string[];
  requiresPlugin?: boolean;
  reason?: string;
}

const defaultState: CastaliaRepositoryState = {
  repositories: [],
};
const registrationPromises = new Map<string, Promise<CastaliaProfile | null>>();

const castaliaProfileSchema = z.object({
  userId: z.string(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  registeredAt: z.number(),
});

const castaliaRepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  branch: z.string().optional(),
  provider: z.enum(['castalia', 'git', 'local']).optional(),
  role: z.enum(['owner', 'editor', 'reader']).optional(),
  updatedAt: z.number().optional(),
});

const codexDraftSchema = z.object({
  repositoryId: z.string().optional(),
  bookHash: z.string(),
  sectionIndex: z.number(),
  sectionLabel: z.string().optional(),
  sectionHref: z.string().optional(),
  html: z.string(),
  text: z.string(),
  syncStatus: z.enum(['local', 'pushed', 'error']).optional(),
  updatedAt: z.number(),
  pushedAt: z.number().optional(),
});

const statusResponseSchema = z
  .object({
    service: z.string().optional(),
    version: z.string().optional(),
    endpoints: z.array(z.string()).optional(),
    repositoryPlugins: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          version: z.string(),
          provider: z.enum(['castalia', 'git', 'local']),
          entrypoint: z.enum(['castalia-api', 'local-artifact']),
          capabilities: z.array(z.string()),
        }),
      )
      .optional(),
  })
  .passthrough();

const registerUserResponseSchema = z.object({
  profile: castaliaProfileSchema,
});

const repositoriesResponseSchema = z.object({
  repositories: z.array(castaliaRepositorySchema),
});

const repositoryResponseSchema = z.object({
  repository: castaliaRepositorySchema,
});

const codexDraftResponseSchema = z.object({
  draft: codexDraftSchema.nullable().optional(),
});

const codexDraftsResponseSchema = z.object({
  drafts: z.array(codexDraftSchema),
});

const getCastaliaApiBaseUrl = () =>
  getRuntimeConfig()?.castaliaApiBaseUrl ?? process.env['NEXT_PUBLIC_CASTALIA_API_BASE_URL'] ?? '';

const isCastaliaApiConfigured = () => Boolean(getCastaliaApiBaseUrl());

const readStoredState = (): CastaliaRepositoryState => {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as CastaliaRepositoryState;
    return {
      ...defaultState,
      ...parsed,
      repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
    };
  } catch {
    return defaultState;
  }
};

const writeStoredState = (state: CastaliaRepositoryState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const parseCastaliaResponse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Castalia response contract mismatch: ${result.error.issues[0]?.message}`);
  }
  return result.data;
};

export const requestCastalia = async <T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T | null> => {
  const baseUrl = getCastaliaApiBaseUrl();
  if (!baseUrl) return null;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Castalia request failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

const getDisplayName = (user: User) =>
  (user.user_metadata?.['full_name'] as string | undefined) ??
  (user.user_metadata?.['name'] as string | undefined) ??
  user.email?.split('@')[0];

export const castaliaClient = {
  getState: readStoredState,

  async checkApiStatus(token?: string): Promise<CastaliaApiStatus> {
    const baseUrl = getCastaliaApiBaseUrl();
    if (!baseUrl) {
      return {
        configured: false,
        reachable: false,
      };
    }

    try {
      const remote = await requestCastalia<unknown>('/v0/status', token);
      const status = remote ? parseCastaliaResponse(statusResponseSchema, remote) : null;
      return {
        configured: true,
        reachable: true,
        baseUrl,
        service: status?.service,
        version: status?.version,
        endpoints: status?.endpoints,
        repositoryPlugins: status?.repositoryPlugins,
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        baseUrl,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  async registerUser(user: User, token: string): Promise<CastaliaProfile> {
    const fallbackProfile: CastaliaProfile = {
      userId: user.id,
      email: user.email,
      displayName: getDisplayName(user),
      registeredAt: Date.now(),
    };
    const remote = await requestCastalia<unknown>('/v0/users/register', token, {
      method: 'POST',
      body: JSON.stringify(fallbackProfile),
    });
    const profile = remote
      ? parseCastaliaResponse(registerUserResponseSchema, remote).profile
      : fallbackProfile;
    const state = readStoredState();
    writeStoredState({ ...state, profile });
    return profile;
  },

  async ensureRegistered(user: User, token: string): Promise<CastaliaProfile | null> {
    const state = readStoredState();
    if (state.profile?.userId === user.id) return state.profile;
    const pending = registrationPromises.get(user.id);
    if (pending) return pending;

    const promise = this.registerUser(user, token)
      .catch((error) => {
        console.warn('Castalia registration failed:', error);
        return null;
      })
      .finally(() => {
        registrationPromises.delete(user.id);
      });
    registrationPromises.set(user.id, promise);
    return promise;
  },

  async listRepositories(token: string): Promise<CastaliaRepository[]> {
    const remote = await requestCastalia<unknown>('/v0/repositories', token);
    if (remote) {
      const repositories = parseCastaliaResponse(repositoriesResponseSchema, remote).repositories;
      const state = readStoredState();
      const activeRepositoryId =
        state.activeRepositoryId ?? repositories[0]?.id ?? state.activeRepositoryId;
      writeStoredState({ ...state, repositories, activeRepositoryId });
      return repositories;
    }
    return readStoredState().repositories;
  },

  saveRepository(repository: CastaliaRepository): CastaliaRepositoryState {
    const state = readStoredState();
    const repositories = [
      repository,
      ...state.repositories.filter((item) => item.id !== repository.id),
    ];
    const nextState = {
      ...state,
      repositories,
      activeRepositoryId: state.activeRepositoryId ?? repository.id,
    };
    writeStoredState(nextState);
    return nextState;
  },

  async saveRemoteRepository(
    token: string,
    repository: CastaliaRepository,
  ): Promise<CastaliaRepository | null> {
    const remote = await requestCastalia<unknown>('/v0/repositories', token, {
      method: 'PUT',
      body: JSON.stringify(repository),
    });
    return remote ? parseCastaliaResponse(repositoryResponseSchema, remote).repository : null;
  },

  setActiveRepository(repositoryId: string): CastaliaRepositoryState {
    const state = readStoredState();
    const nextState = { ...state, activeRepositoryId: repositoryId };
    writeStoredState(nextState);
    return nextState;
  },

  getActiveRepository(): CastaliaRepository | null {
    const state = readStoredState();
    return state.repositories.find((repo) => repo.id === state.activeRepositoryId) ?? null;
  },

  getRepositorySyncStatus(repository?: CastaliaRepository | null): CastaliaRepositorySyncStatus {
    if (!repository) {
      return {
        providerId: 'none',
        providerLabel: 'No repository',
        canPullDrafts: false,
        canPushDrafts: false,
        mode: 'local-artifact',
        pluginId: 'none',
        pluginVersion: '0.0.0',
        pluginCapabilities: [],
        reason: 'Select a repository before synchronizing Codex drafts.',
      };
    }
    const provider = getCastaliaRepositoryProvider(repository);
    return {
      providerId: provider.id,
      providerLabel: provider.label,
      pluginId: provider.plugin.id,
      pluginVersion: provider.plugin.version,
      pluginCapabilities: provider.plugin.capabilities,
      ...provider.getCapabilities(repository, {
        apiConfigured: isCastaliaApiConfigured(),
      }),
    };
  },

  async pushCodexDraft(token: string, draft: CodexDraft): Promise<CodexDraft | null> {
    if (!draft.repositoryId) return null;
    const repository =
      readStoredState().repositories.find((item) => item.id === draft.repositoryId) ??
      ({
        id: draft.repositoryId,
        name: draft.repositoryId,
        provider: 'castalia',
      } satisfies CastaliaRepository);
    const provider = getCastaliaRepositoryProvider(repository);
    const syncStatus = this.getRepositorySyncStatus(repository);
    if (!syncStatus.canPushDrafts) {
      throw new Error(syncStatus.reason ?? 'Repository provider cannot push Codex drafts');
    }
    const draftsPath = provider.getDraftsPath(repository);
    if (!draftsPath) throw new Error('Repository provider does not expose Codex draft sync');
    const remote = await requestCastalia<unknown>(draftsPath, token, {
      method: 'PUT',
      body: JSON.stringify({ draft }),
    });
    return remote ? (parseCastaliaResponse(codexDraftResponseSchema, remote).draft ?? null) : null;
  },

  async listCodexDrafts(token: string, repositoryId: string): Promise<CodexDraft[]> {
    const repository =
      readStoredState().repositories.find((item) => item.id === repositoryId) ??
      ({
        id: repositoryId,
        name: repositoryId,
        provider: 'castalia',
      } satisfies CastaliaRepository);
    const provider = getCastaliaRepositoryProvider(repository);
    const syncStatus = this.getRepositorySyncStatus(repository);
    if (!syncStatus.canPullDrafts) return [];
    const draftsPath = provider.getDraftsPath(repository);
    if (!draftsPath) return [];
    const remote = await requestCastalia<unknown>(draftsPath, token);
    return remote ? parseCastaliaResponse(codexDraftsResponseSchema, remote).drafts : [];
  },

  async pushCodexDrafts(token: string, drafts: CodexDraft[]): Promise<CodexDraft[]> {
    const pushedDrafts: CodexDraft[] = [];
    for (const draft of drafts) {
      const pushedDraft = await this.pushCodexDraft(token, draft);
      pushedDrafts.push(pushedDraft ?? draft);
    }
    return pushedDrafts;
  },
};
