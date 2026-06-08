'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  GitBranch,
  Library,
  PackageOpen,
  RefreshCw,
  Save,
  Server,
  Upload,
  UploadCloud,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  CastaliaApiStatus,
  castaliaClient,
  CastaliaRepository,
  CastaliaRepositoryState,
} from '@/services/castalia/client';
import { CodexDraft, codexDraftStore } from '@/services/castalia/codexDrafts';
import {
  createCastaliaRepositoryArtifact,
  getCastaliaRepositoryArtifactFilename,
  parseCastaliaRepositoryArtifact,
  serializeCastaliaRepositoryArtifact,
} from '@/services/castalia/repositoryArtifact';
import { createCastaliaRepositorySnapshotZip } from '@/services/castalia/repositorySnapshot';
import { uniqueId } from '@/utils/misc';

interface DraftStats {
  total: number;
  pending: number;
}

const getDraftStats = (repositoryId?: string): DraftStats => {
  if (!repositoryId) return { total: 0, pending: 0 };
  const drafts = codexDraftStore.listRepositoryDrafts(repositoryId);
  return {
    total: drafts.length,
    pending: drafts.filter((draft) => draft.syncStatus !== 'pushed').length,
  };
};

const downloadTextFile = (filename: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
};

const CastaliaRepositorySection = () => {
  const _ = useTranslation();
  const { user, token } = useAuth();
  const artifactInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CastaliaRepositoryState>(() => castaliaClient.getState());
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [apiStatus, setApiStatus] = useState<CastaliaApiStatus | null>(null);
  const [draftStats, setDraftStats] = useState<DraftStats>(() =>
    getDraftStats(castaliaClient.getState().activeRepositoryId),
  );

  useEffect(() => {
    const state = castaliaClient.getState();
    setState(state);
    setDraftStats(getDraftStats(state.activeRepositoryId));
    void castaliaClient.checkApiStatus(token ?? undefined).then(setApiStatus);
  }, [token]);

  const activeRepository = useMemo(
    () => state.repositories.find((repo) => repo.id === state.activeRepositoryId),
    [state.activeRepositoryId, state.repositories],
  );
  const syncStatus = useMemo(
    () => castaliaClient.getRepositorySyncStatus(activeRepository),
    [activeRepository, apiStatus],
  );

  const handleRegister = async () => {
    if (!user || !token) return;
    setIsLoading(true);
    setMessage('');
    try {
      const profile = await castaliaClient.registerUser(user, token);
      setState(castaliaClient.getState());
      setMessage(profile.email ? _('Castalia registration saved') : _('Profile saved'));
    } catch (error) {
      console.error('Castalia registration failed:', error);
      setMessage(_('Unable to reach Castalia. Local profile saved when possible.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckApiStatus = async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const status = await castaliaClient.checkApiStatus(token ?? undefined);
      setApiStatus(status);
      setMessage(status.reachable ? _('Castalia API reachable') : _('Castalia API unavailable'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshRepositories = async () => {
    if (!token) return;
    setIsLoading(true);
    setMessage('');
    try {
      await castaliaClient.listRepositories(token);
      const state = castaliaClient.getState();
      const repositoryId = state.activeRepositoryId;
      if (repositoryId) {
        const drafts = await castaliaClient.listCodexDrafts(token, repositoryId);
        codexDraftStore.mergeDrafts(drafts);
      }
      setState(state);
      setDraftStats(getDraftStats(repositoryId));
      setMessage(_('Repository access refreshed'));
    } catch (error) {
      console.error('Castalia repository refresh failed:', error);
      setMessage(_('Unable to refresh remote repositories'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveRepository = async () => {
    const trimmedName = repositoryName.trim();
    const trimmedUrl = repositoryUrl.trim();
    if (!trimmedName && !trimmedUrl) return;
    let repository: CastaliaRepository = {
      id: uniqueId(),
      name: trimmedName || trimmedUrl,
      url: trimmedUrl || undefined,
      provider: trimmedUrl ? 'git' : 'local',
      role: 'owner',
      updatedAt: Date.now(),
    };
    setIsLoading(true);
    setMessage('');
    try {
      const repositorySyncStatus = castaliaClient.getRepositorySyncStatus(repository);
      if (token && repositorySyncStatus.canPushDrafts) {
        repository = (await castaliaClient.saveRemoteRepository(token, repository)) ?? repository;
      }
      const state = castaliaClient.saveRepository(repository);
      setState(state);
      setDraftStats(getDraftStats(state.activeRepositoryId));
      setRepositoryName('');
      setRepositoryUrl('');
      setMessage(_('Repository access saved'));
    } catch (error) {
      console.error('Castalia repository save failed:', error);
      setMessage(_('Unable to save remote repository'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRepository = (repositoryId: string) => {
    setState(castaliaClient.setActiveRepository(repositoryId));
    setDraftStats(getDraftStats(repositoryId));
  };

  const updatePushedDrafts = (drafts: CodexDraft[]) => {
    for (const draft of drafts) {
      codexDraftStore.markDraftPushed(draft);
    }
  };

  const handlePushDrafts = async () => {
    if (!token || !activeRepository) return;
    const pendingDrafts = codexDraftStore.listPendingRepositoryDrafts(activeRepository.id);
    if (pendingDrafts.length === 0) {
      setMessage(_('No pending Codex drafts'));
      return;
    }
    if (!syncStatus.canPushDrafts) {
      setMessage(_(syncStatus.reason ?? 'Repository sync is not available'));
      return;
    }
    setIsLoading(true);
    setMessage('');
    try {
      const pushedDrafts = await castaliaClient.pushCodexDrafts(token, pendingDrafts);
      updatePushedDrafts(pushedDrafts);
      setDraftStats(getDraftStats(activeRepository.id));
      setMessage(_('Codex drafts pushed'));
    } catch (error) {
      console.error('Castalia draft push failed:', error);
      for (const draft of pendingDrafts) {
        codexDraftStore.markDraftError(draft);
      }
      setDraftStats(getDraftStats(activeRepository.id));
      setMessage(_('Unable to push Codex drafts'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportArtifact = () => {
    if (!activeRepository) return;
    const drafts = codexDraftStore.listRepositoryDrafts(activeRepository.id);
    const artifact = createCastaliaRepositoryArtifact(activeRepository, drafts);
    downloadTextFile(
      getCastaliaRepositoryArtifactFilename(activeRepository),
      serializeCastaliaRepositoryArtifact(artifact),
    );
    setMessage(_('Repository artifact exported'));
  };

  const handleExportSnapshot = async () => {
    if (!activeRepository) return;
    try {
      const drafts = codexDraftStore.listRepositoryDrafts(activeRepository.id);
      const file = await createCastaliaRepositorySnapshotZip(activeRepository, drafts);
      downloadFile(file);
      setMessage(_('Repository snapshot exported'));
    } catch (error) {
      console.error('Castalia repository snapshot export failed:', error);
      setMessage(_('Unable to export repository snapshot'));
    }
  };

  const handleImportArtifact = async (file: File | undefined) => {
    if (!file) return;
    try {
      const artifact = parseCastaliaRepositoryArtifact(await file.text());
      castaliaClient.saveRepository({
        ...artifact.repository,
        updatedAt: Date.now(),
      });
      codexDraftStore.mergeDrafts(artifact.drafts);
      castaliaClient.setActiveRepository(artifact.repository.id);
      setState(castaliaClient.getState());
      setDraftStats(getDraftStats(artifact.repository.id));
      setMessage(_('Repository artifact imported'));
    } catch (error) {
      console.error('Castalia repository artifact import failed:', error);
      setMessage(_('Unable to import repository artifact'));
    } finally {
      if (artifactInputRef.current) {
        artifactInputRef.current.value = '';
      }
    }
  };

  return (
    <section className='flex flex-col gap-4'>
      <div>
        <h2 className='text-base font-semibold'>{_('Castalia')}</h2>
        <p className='text-base-content/70 text-sm'>
          {_('Register this account and connect the Codex repository used for drafts.')}
        </p>
      </div>

      <div className='border-base-300 bg-base-100 rounded-lg border p-4'>
        <div className='mb-4 flex items-start gap-3'>
          <Server className='mt-1 h-5 w-5 flex-none' aria-hidden='true' />
          <div className='min-w-0 flex-1'>
            <div className='font-medium'>
              {apiStatus?.reachable
                ? _('API Online')
                : apiStatus?.configured
                  ? _('API Offline')
                  : _('Local Mode')}
            </div>
            <div className='text-base-content/70 truncate text-sm'>
              {apiStatus?.baseUrl ?? _('No Castalia API configured')}
              {apiStatus?.version ? ` · ${apiStatus.version}` : ''}
            </div>
            {apiStatus?.repositoryPlugins?.length ? (
              <div className='text-base-content/60 truncate text-xs'>
                {_('Repository plugins')}: {apiStatus.repositoryPlugins.length}
              </div>
            ) : null}
          </div>
          <button
            type='button'
            className='btn btn-sm'
            onClick={handleCheckApiStatus}
            disabled={isLoading}
            title={_('Check Castalia API')}
            aria-label={_('Check Castalia API')}
          >
            <RefreshCw className='h-4 w-4' aria-hidden='true' />
          </button>
        </div>

        <div className='flex items-start gap-3'>
          <UserPlus className='mt-1 h-5 w-5 flex-none' aria-hidden='true' />
          <div className='min-w-0 flex-1'>
            <div className='font-medium'>
              {state.profile ? _('Registered') : _('Not Registered')}
            </div>
            <div className='text-base-content/70 truncate text-sm'>
              {state.profile?.email ?? user?.email ?? _('No account email')}
            </div>
          </div>
          <button
            type='button'
            className='btn btn-sm'
            onClick={handleRegister}
            disabled={isLoading || !user || !token}
            title={_('Register')}
            aria-label={_('Register')}
          >
            <UserPlus className='h-4 w-4' aria-hidden='true' />
          </button>
        </div>
      </div>

      <div className='border-base-300 bg-base-100 rounded-lg border p-4'>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-3'>
            <Library className='h-5 w-5 flex-none' aria-hidden='true' />
            <div className='min-w-0'>
              <div className='font-medium'>{_('Repository Access')}</div>
              <div className='text-base-content/70 truncate text-sm'>
                {activeRepository?.name ?? _('No active repository')}
              </div>
              <div className='text-base-content/60 truncate text-xs'>
                {syncStatus.providerLabel}
                {syncStatus.providerId !== 'none' ? ` · v${syncStatus.pluginVersion}` : ''}
                {syncStatus.reason ? ` · ${syncStatus.reason}` : ''}
              </div>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <input
              ref={artifactInputRef}
              type='file'
              accept='application/json,.json'
              className='hidden'
              onChange={(event) => void handleImportArtifact(event.currentTarget.files?.[0])}
            />
            <button
              type='button'
              className='btn btn-sm'
              onClick={() => artifactInputRef.current?.click()}
              disabled={isLoading}
              title={_('Import repository artifact')}
              aria-label={_('Import repository artifact')}
            >
              <Upload className='h-4 w-4' aria-hidden='true' />
            </button>
            <button
              type='button'
              className='btn btn-sm'
              onClick={handleExportArtifact}
              disabled={isLoading || !activeRepository}
              title={_('Export repository artifact')}
              aria-label={_('Export repository artifact')}
            >
              <Download className='h-4 w-4' aria-hidden='true' />
            </button>
            <button
              type='button'
              className='btn btn-sm'
              onClick={() => void handleExportSnapshot()}
              disabled={isLoading || !activeRepository}
              title={_('Export Git snapshot')}
              aria-label={_('Export Git snapshot')}
            >
              <PackageOpen className='h-4 w-4' aria-hidden='true' />
            </button>
            <button
              type='button'
              className='btn btn-sm'
              onClick={handlePushDrafts}
              disabled={
                isLoading ||
                !token ||
                !activeRepository ||
                draftStats.pending === 0 ||
                !syncStatus.canPushDrafts
              }
              title={_('Push Codex drafts')}
              aria-label={_('Push Codex drafts')}
            >
              <UploadCloud className='h-4 w-4' aria-hidden='true' />
            </button>
            <button
              type='button'
              className='btn btn-sm'
              onClick={handleRefreshRepositories}
              disabled={isLoading || !token}
              title={_('Refresh')}
              aria-label={_('Refresh')}
            >
              <RefreshCw className='h-4 w-4' aria-hidden='true' />
            </button>
          </div>
        </div>

        <div className='text-base-content/70 mb-3 text-sm'>
          {_('Codex drafts')}: {draftStats.total}
          {draftStats.pending > 0 && (
            <span className='text-warning ms-2'>
              {_('Pending')}: {draftStats.pending}
            </span>
          )}
        </div>

        {state.repositories.length > 0 && (
          <div className='mb-4 flex flex-col gap-2'>
            {state.repositories.map((repository) => (
              <button
                type='button'
                key={repository.id}
                className='border-base-300 flex w-full items-center gap-3 rounded-md border px-3 py-2 text-start'
                onClick={() => handleSelectRepository(repository.id)}
              >
                <GitBranch className='h-4 w-4 flex-none' aria-hidden='true' />
                <span className='min-w-0 flex-1 truncate'>{repository.name}</span>
                {state.activeRepositoryId === repository.id && (
                  <span className='text-success text-xs'>{_('Active')}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className='grid gap-2 sm:grid-cols-[1fr_1fr_auto]'>
          <input
            className='input input-bordered input-sm min-w-0'
            value={repositoryName}
            onChange={(event) => setRepositoryName(event.target.value)}
            placeholder={_('Repository name')}
          />
          <input
            className='input input-bordered input-sm min-w-0'
            value={repositoryUrl}
            onChange={(event) => setRepositoryUrl(event.target.value)}
            placeholder={_('Git or Castalia URL')}
          />
          <button
            type='button'
            className='btn btn-sm'
            onClick={() => void handleSaveRepository()}
            disabled={isLoading || (!repositoryName.trim() && !repositoryUrl.trim())}
            title={_('Save')}
            aria-label={_('Save')}
          >
            <Save className='h-4 w-4' aria-hidden='true' />
          </button>
        </div>
      </div>

      {message && <p className='text-base-content/70 text-sm'>{message}</p>}
    </section>
  );
};

export default CastaliaRepositorySection;
