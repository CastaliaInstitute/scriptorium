import type { User } from '@supabase/supabase-js';
import type { CastaliaProfile, CastaliaRepository } from './client';
import type { CodexDraft } from './codexDrafts';
import { createSupabaseAdminClient } from '@/utils/supabase';

interface CastaliaUserRecord {
  profile: CastaliaProfile;
  repositories: Map<string, CastaliaRepository>;
  drafts: Map<string, Map<string, CodexDraft>>;
}

interface CastaliaServerStore {
  users: Map<string, CastaliaUserRecord>;
}

const STORE_SYMBOL = Symbol.for('castalia.serverStore.v0');

const getGlobalStore = (): CastaliaServerStore => {
  const globalObject = globalThis as typeof globalThis & {
    [STORE_SYMBOL]?: CastaliaServerStore;
  };
  globalObject[STORE_SYMBOL] ??= {
    users: new Map(),
  };
  return globalObject[STORE_SYMBOL];
};

const getDisplayName = (user: User) =>
  (user.user_metadata?.['full_name'] as string | undefined) ??
  (user.user_metadata?.['name'] as string | undefined) ??
  user.email?.split('@')[0];

const getDefaultRepository = (user: User): CastaliaRepository => ({
  id: `castalia-${user.id}`,
  name: 'Scriptorium Codices',
  provider: 'castalia',
  role: 'owner',
  updatedAt: Date.now(),
});

const getDraftKey = (draft: Pick<CodexDraft, 'bookHash' | 'sectionIndex'>) =>
  `${draft.bookHash}:${draft.sectionIndex}`;

const shouldUseSupabaseStore = () =>
  process.env['CASTALIA_SERVER_STORE'] !== 'memory' && Boolean(process.env['SUPABASE_ADMIN_KEY']);

const toIsoDate = (timestamp: number | undefined) =>
  new Date(timestamp && Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();

const toTimestamp = (value: unknown) =>
  typeof value === 'string' ? new Date(value).getTime() : Date.now();

const toRepository = (row: Record<string, unknown>): CastaliaRepository => ({
  id: String(row['id']),
  name: String(row['name']),
  url: typeof row['url'] === 'string' ? row['url'] : undefined,
  branch: typeof row['branch'] === 'string' ? row['branch'] : undefined,
  provider:
    row['provider'] === 'castalia' || row['provider'] === 'git' || row['provider'] === 'local'
      ? row['provider']
      : 'castalia',
  role:
    row['role'] === 'owner' || row['role'] === 'editor' || row['role'] === 'reader'
      ? row['role']
      : 'owner',
  updatedAt: toTimestamp(row['updated_at']),
});

const toDraft = (row: Record<string, unknown>): CodexDraft => ({
  repositoryId: String(row['repository_id']),
  bookHash: String(row['book_hash']),
  sectionIndex: Number(row['section_index']),
  sectionLabel: typeof row['section_label'] === 'string' ? row['section_label'] : undefined,
  sectionHref: typeof row['section_href'] === 'string' ? row['section_href'] : undefined,
  html: String(row['html']),
  text: String(row['text']),
  syncStatus:
    row['sync_status'] === 'local' ||
    row['sync_status'] === 'pushed' ||
    row['sync_status'] === 'error'
      ? row['sync_status']
      : 'pushed',
  updatedAt: Number(row['updated_at_ms']),
  pushedAt: typeof row['pushed_at_ms'] === 'number' ? row['pushed_at_ms'] : undefined,
});

const toProfile = (row: Record<string, unknown>): CastaliaProfile => ({
  userId: String(row['user_id']),
  email: typeof row['email'] === 'string' ? row['email'] : undefined,
  displayName: typeof row['display_name'] === 'string' ? row['display_name'] : undefined,
  registeredAt: toTimestamp(row['registered_at']),
});

const ensureUserRecord = (user: User): CastaliaUserRecord => {
  const store = getGlobalStore();
  const existing = store.users.get(user.id);
  if (existing) return existing;

  const profile: CastaliaProfile = {
    userId: user.id,
    email: user.email,
    displayName: getDisplayName(user),
    registeredAt: Date.now(),
  };
  const defaultRepository = getDefaultRepository(user);
  const record: CastaliaUserRecord = {
    profile,
    repositories: new Map([[defaultRepository.id, defaultRepository]]),
    drafts: new Map(),
  };
  store.users.set(user.id, record);
  return record;
};

const memoryStore = {
  reset() {
    getGlobalStore().users.clear();
  },

  registerUser(user: User, profile?: Partial<CastaliaProfile>): CastaliaProfile {
    const record = ensureUserRecord(user);
    record.profile = {
      ...record.profile,
      email: profile?.email ?? record.profile.email,
      displayName: profile?.displayName ?? record.profile.displayName,
      registeredAt: record.profile.registeredAt,
      userId: user.id,
    };
    return record.profile;
  },

  listRepositories(user: User): CastaliaRepository[] {
    const record = ensureUserRecord(user);
    return [...record.repositories.values()].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
  },

  saveRepository(user: User, repository: CastaliaRepository): CastaliaRepository {
    const record = ensureUserRecord(user);
    const nextRepository = {
      ...repository,
      provider: repository.provider ?? 'castalia',
      role: repository.role ?? 'owner',
      updatedAt: Date.now(),
    } satisfies CastaliaRepository;
    record.repositories.set(nextRepository.id, nextRepository);
    return nextRepository;
  },

  listDrafts(user: User, repositoryId: string): CodexDraft[] {
    const record = ensureUserRecord(user);
    return [...(record.drafts.get(repositoryId)?.values() ?? [])].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  },

  saveDraft(user: User, repositoryId: string, draft: CodexDraft): CodexDraft {
    const record = ensureUserRecord(user);
    if (!record.repositories.has(repositoryId)) {
      this.saveRepository(user, {
        id: repositoryId,
        name: repositoryId,
        provider: 'castalia',
        role: 'owner',
      });
    }
    const repositoryDrafts = record.drafts.get(repositoryId) ?? new Map<string, CodexDraft>();
    const nextDraft = {
      ...draft,
      repositoryId,
      syncStatus: 'pushed',
      pushedAt: Date.now(),
    } satisfies CodexDraft;
    repositoryDrafts.set(getDraftKey(nextDraft), nextDraft);
    record.drafts.set(repositoryId, repositoryDrafts);
    return nextDraft;
  },
};

const supabaseStore = {
  async registerUser(user: User, profile?: Partial<CastaliaProfile>): Promise<CastaliaProfile> {
    const supabase = createSupabaseAdminClient();
    const registeredAt = Date.now();
    const { data, error } = await supabase
      .from('castalia_profiles')
      .upsert(
        {
          user_id: user.id,
          email: profile?.email ?? user.email,
          display_name: profile?.displayName ?? getDisplayName(user),
          registered_at: toIsoDate(profile?.registeredAt ?? registeredAt),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('user_id,email,display_name,registered_at')
      .single();
    if (error) throw error;

    await this.saveRepository(user, getDefaultRepository(user));
    return toProfile(data as Record<string, unknown>);
  },

  async listRepositories(user: User): Promise<CastaliaRepository[]> {
    const supabase = createSupabaseAdminClient();
    await this.saveRepository(user, getDefaultRepository(user));
    const { data, error } = await supabase
      .from('castalia_repositories')
      .select('id,name,url,branch,provider,role,updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toRepository);
  },

  async saveRepository(user: User, repository: CastaliaRepository): Promise<CastaliaRepository> {
    const supabase = createSupabaseAdminClient();
    const updatedAt = repository.updatedAt ?? Date.now();
    const { data, error } = await supabase
      .from('castalia_repositories')
      .upsert(
        {
          user_id: user.id,
          id: repository.id,
          name: repository.name,
          url: repository.url,
          branch: repository.branch,
          provider: repository.provider ?? 'castalia',
          role: repository.role ?? 'owner',
          updated_at: toIsoDate(updatedAt),
        },
        { onConflict: 'user_id,id' },
      )
      .select('id,name,url,branch,provider,role,updated_at')
      .single();
    if (error) throw error;
    return toRepository(data as Record<string, unknown>);
  },

  async listDrafts(user: User, repositoryId: string): Promise<CodexDraft[]> {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('castalia_codex_drafts')
      .select(
        'repository_id,book_hash,section_index,section_label,section_href,html,text,sync_status,updated_at_ms,pushed_at_ms',
      )
      .eq('user_id', user.id)
      .eq('repository_id', repositoryId)
      .order('updated_at_ms', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toDraft);
  },

  async saveDraft(user: User, repositoryId: string, draft: CodexDraft): Promise<CodexDraft> {
    const supabase = createSupabaseAdminClient();
    await this.saveRepository(user, {
      id: repositoryId,
      name: repositoryId,
      provider: 'castalia',
      role: 'owner',
    });
    const nextDraft = {
      ...draft,
      repositoryId,
      syncStatus: 'pushed',
      pushedAt: Date.now(),
    } satisfies CodexDraft;
    const { data, error } = await supabase
      .from('castalia_codex_drafts')
      .upsert(
        {
          user_id: user.id,
          repository_id: repositoryId,
          book_hash: nextDraft.bookHash,
          section_index: nextDraft.sectionIndex,
          section_label: nextDraft.sectionLabel,
          section_href: nextDraft.sectionHref,
          html: nextDraft.html,
          text: nextDraft.text,
          sync_status: nextDraft.syncStatus,
          updated_at_ms: nextDraft.updatedAt,
          pushed_at_ms: nextDraft.pushedAt,
          server_updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,repository_id,book_hash,section_index' },
      )
      .select(
        'repository_id,book_hash,section_index,section_label,section_href,html,text,sync_status,updated_at_ms,pushed_at_ms',
      )
      .single();
    if (error) throw error;
    return toDraft(data as Record<string, unknown>);
  },
};

const withStoreFallback = async <T>(operation: () => Promise<T>, fallback: () => T): Promise<T> => {
  if (!shouldUseSupabaseStore()) return fallback();
  try {
    return await operation();
  } catch (error) {
    console.warn('Castalia Supabase store unavailable; using memory store:', error);
    return fallback();
  }
};

export const castaliaServerStore = {
  reset() {
    memoryStore.reset();
  },

  registerUser(user: User, profile?: Partial<CastaliaProfile>): Promise<CastaliaProfile> {
    return withStoreFallback(
      () => supabaseStore.registerUser(user, profile),
      () => memoryStore.registerUser(user, profile),
    );
  },

  listRepositories(user: User): Promise<CastaliaRepository[]> {
    return withStoreFallback(
      () => supabaseStore.listRepositories(user),
      () => memoryStore.listRepositories(user),
    );
  },

  saveRepository(user: User, repository: CastaliaRepository): Promise<CastaliaRepository> {
    return withStoreFallback(
      () => supabaseStore.saveRepository(user, repository),
      () => memoryStore.saveRepository(user, repository),
    );
  },

  listDrafts(user: User, repositoryId: string): Promise<CodexDraft[]> {
    return withStoreFallback(
      () => supabaseStore.listDrafts(user, repositoryId),
      () => memoryStore.listDrafts(user, repositoryId),
    );
  },

  saveDraft(user: User, repositoryId: string, draft: CodexDraft): Promise<CodexDraft> {
    return withStoreFallback(
      () => supabaseStore.saveDraft(user, repositoryId, draft),
      () => memoryStore.saveDraft(user, repositoryId, draft),
    );
  },
};
