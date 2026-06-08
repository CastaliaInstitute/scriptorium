const STORAGE_KEY = 'castalia:codex-drafts:v1';

export interface CodexDraft {
  repositoryId?: string;
  bookHash: string;
  sectionIndex: number;
  sectionLabel?: string;
  sectionHref?: string;
  html: string;
  text: string;
  syncStatus?: 'local' | 'pushed' | 'error';
  updatedAt: number;
  pushedAt?: number;
}

type DraftMap = Record<string, CodexDraft>;

export const getCodexDraftKey = (bookHash: string, sectionIndex: number) =>
  `${bookHash}:${sectionIndex}`;

const readDraftMap = (): DraftMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DraftMap) : {};
  } catch {
    return {};
  }
};

const writeDraftMap = (drafts: DraftMap) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
};

const writeDraft = (draft: CodexDraft): CodexDraft => {
  const drafts = readDraftMap();
  drafts[getCodexDraftKey(draft.bookHash, draft.sectionIndex)] = draft;
  writeDraftMap(drafts);
  return draft;
};

const isNewerDraft = (incoming: CodexDraft, existing?: CodexDraft) =>
  !existing || incoming.updatedAt > existing.updatedAt;

export const codexDraftStore = {
  getDraft(bookHash: string, sectionIndex: number): CodexDraft | null {
    return readDraftMap()[getCodexDraftKey(bookHash, sectionIndex)] ?? null;
  },

  saveDraft(draft: Omit<CodexDraft, 'updatedAt'>): CodexDraft {
    const drafts = readDraftMap();
    const nextDraft: CodexDraft = {
      ...draft,
      syncStatus: draft.syncStatus ?? 'local',
      updatedAt: Date.now(),
    };
    drafts[getCodexDraftKey(draft.bookHash, draft.sectionIndex)] = nextDraft;
    writeDraftMap(drafts);
    return nextDraft;
  },

  markDraftPushed(draft: CodexDraft): CodexDraft {
    return writeDraft({
      ...draft,
      syncStatus: 'pushed',
      pushedAt: draft.pushedAt ?? Date.now(),
    });
  },

  markDraftError(draft: CodexDraft): CodexDraft {
    return this.saveDraft({
      ...draft,
      syncStatus: 'error',
    });
  },

  listBookDrafts(bookHash: string): CodexDraft[] {
    return Object.values(readDraftMap())
      .filter((draft) => draft.bookHash === bookHash)
      .sort((a, b) => a.sectionIndex - b.sectionIndex);
  },

  listDrafts(): CodexDraft[] {
    return Object.values(readDraftMap()).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  listRepositoryDrafts(repositoryId: string): CodexDraft[] {
    return this.listDrafts().filter((draft) => draft.repositoryId === repositoryId);
  },

  listPendingRepositoryDrafts(repositoryId: string): CodexDraft[] {
    return this.listRepositoryDrafts(repositoryId).filter((draft) => draft.syncStatus !== 'pushed');
  },

  mergeDrafts(drafts: CodexDraft[]): CodexDraft[] {
    const draftMap = readDraftMap();
    const mergedDrafts: CodexDraft[] = [];
    for (const draft of drafts) {
      const key = getCodexDraftKey(draft.bookHash, draft.sectionIndex);
      if (!isNewerDraft(draft, draftMap[key])) continue;
      draftMap[key] = draft;
      mergedDrafts.push(draft);
    }
    writeDraftMap(draftMap);
    return mergedDrafts;
  },
};
