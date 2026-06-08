export type CastaliaRepositoryProviderKind = 'castalia' | 'git' | 'local';

export interface CastaliaRepositoryAccess {
  id: string;
  provider?: CastaliaRepositoryProviderKind;
}

export interface CastaliaRepositoryProviderContext {
  apiConfigured: boolean;
}

export interface CastaliaRepositoryProviderCapabilities {
  canPullDrafts: boolean;
  canPushDrafts: boolean;
  mode: 'castalia-api' | 'local-artifact';
  requiresPlugin?: boolean;
  reason?: string;
}

export interface CastaliaRepositoryPluginManifest {
  id: string;
  label: string;
  version: string;
  provider: CastaliaRepositoryProviderKind;
  entrypoint: 'castalia-api' | 'local-artifact';
  capabilities: string[];
}

export interface CastaliaRepositoryProvider {
  id: string;
  label: string;
  plugin: CastaliaRepositoryPluginManifest;
  canHandle(repository: CastaliaRepositoryAccess): boolean;
  getCapabilities(
    repository: CastaliaRepositoryAccess,
    context: CastaliaRepositoryProviderContext,
  ): CastaliaRepositoryProviderCapabilities;
  getDraftsPath(repository: CastaliaRepositoryAccess): string | null;
}

const getRepositoryProviderKind = (repository: CastaliaRepositoryAccess) =>
  repository.provider ?? 'castalia';

const castaliaApiProvider: CastaliaRepositoryProvider = {
  id: 'castalia-api',
  label: 'Castalia API',
  plugin: {
    id: 'castalia.repository.api',
    label: 'Castalia Repository API',
    version: '0.1.0',
    provider: 'castalia',
    entrypoint: 'castalia-api',
    capabilities: [
      'repositories:list',
      'repositories:save',
      'codex-drafts:pull',
      'codex-drafts:push',
    ],
  },
  canHandle(repository) {
    return getRepositoryProviderKind(repository) === 'castalia';
  },
  getCapabilities(_repository, context) {
    if (!context.apiConfigured) {
      return {
        canPullDrafts: false,
        canPushDrafts: false,
        mode: 'castalia-api',
        reason: 'Configure a Castalia API URL to synchronize repository drafts.',
      };
    }
    return {
      canPullDrafts: true,
      canPushDrafts: true,
      mode: 'castalia-api',
    };
  },
  getDraftsPath(repository) {
    return `/v0/repositories/${encodeURIComponent(repository.id)}/codex-drafts`;
  },
};

const gitRepositoryProvider: CastaliaRepositoryProvider = {
  id: 'castalia-git',
  label: 'Git Repository',
  plugin: {
    id: 'castalia.repository.git',
    label: 'Castalia Git Repository',
    version: '0.1.0',
    provider: 'git',
    entrypoint: 'castalia-api',
    capabilities: ['repositories:save', 'codex-drafts:pull', 'codex-drafts:push', 'git:snapshot'],
  },
  canHandle(repository) {
    return getRepositoryProviderKind(repository) === 'git';
  },
  getCapabilities(_repository, context) {
    if (!context.apiConfigured) {
      return {
        canPullDrafts: false,
        canPushDrafts: false,
        mode: 'castalia-api',
        requiresPlugin: true,
        reason:
          'Configure a Castalia API URL with the Git repository plugin to synchronize drafts.',
      };
    }
    return {
      canPullDrafts: true,
      canPushDrafts: true,
      mode: 'castalia-api',
      requiresPlugin: true,
      reason: 'Draft sync is delegated to the Castalia Git repository plugin.',
    };
  },
  getDraftsPath(repository) {
    return `/v0/repositories/${encodeURIComponent(repository.id)}/codex-drafts`;
  },
};

const localArtifactProvider: CastaliaRepositoryProvider = {
  id: 'local-artifact',
  label: 'Local Artifact',
  plugin: {
    id: 'castalia.repository.local-artifact',
    label: 'Castalia Local Artifact',
    version: '0.1.0',
    provider: 'local',
    entrypoint: 'local-artifact',
    capabilities: ['artifact:import', 'artifact:export', 'git:snapshot'],
  },
  canHandle(repository) {
    return getRepositoryProviderKind(repository) === 'local';
  },
  getCapabilities() {
    return {
      canPullDrafts: false,
      canPushDrafts: false,
      mode: 'local-artifact',
      reason: 'Export or import the repository artifact to move local drafts.',
    };
  },
  getDraftsPath() {
    return null;
  },
};

const repositoryProviders = [castaliaApiProvider, gitRepositoryProvider, localArtifactProvider];

export const getCastaliaRepositoryProvider = (repository: CastaliaRepositoryAccess) =>
  repositoryProviders.find((provider) => provider.canHandle(repository)) ?? localArtifactProvider;

export const listCastaliaRepositoryProviders = () => [...repositoryProviders];

export const listCastaliaRepositoryPluginManifests = () =>
  repositoryProviders.map((provider) => provider.plugin);
