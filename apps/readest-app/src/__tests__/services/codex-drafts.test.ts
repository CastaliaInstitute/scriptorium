import { beforeEach, describe, expect, test } from 'vitest';
import { codexDraftStore, getCodexDraftKey } from '@/services/castalia/codexDrafts';

beforeEach(() => {
  localStorage.clear();
});

describe('codexDraftStore', () => {
  test('builds stable draft keys', () => {
    expect(getCodexDraftKey('book-1', 3)).toBe('book-1:3');
  });

  test('saves and loads a section draft', () => {
    const draft = codexDraftStore.saveDraft({
      repositoryId: 'repo-1',
      bookHash: 'book-1',
      sectionIndex: 2,
      sectionLabel: 'Chapter 2',
      html: '<p>Edited</p>',
      text: 'Edited',
    });

    expect(draft.updatedAt).toBeGreaterThan(0);
    expect(draft.repositoryId).toBe('repo-1');
    expect(draft.syncStatus).toBe('local');
    expect(codexDraftStore.getDraft('book-1', 2)).toEqual(draft);
  });

  test('marks draft push status', () => {
    const draft = codexDraftStore.saveDraft({
      repositoryId: 'repo-1',
      bookHash: 'book-1',
      sectionIndex: 2,
      html: '<p>Edited</p>',
      text: 'Edited',
    });

    const pushedDraft = codexDraftStore.markDraftPushed(draft);
    expect(pushedDraft.syncStatus).toBe('pushed');
    expect(pushedDraft.pushedAt).toBeGreaterThan(0);

    const errorDraft = codexDraftStore.markDraftError(pushedDraft);
    expect(errorDraft.syncStatus).toBe('error');
  });

  test('preserves repository provenance when marking pushed remote drafts', () => {
    const pushedDraft = codexDraftStore.markDraftPushed({
      repositoryId: 'repo-1',
      bookHash: 'book-1',
      sectionIndex: 2,
      html: '<p>Edited</p>',
      text: 'Edited',
      syncStatus: 'pushed',
      updatedAt: 100,
      pushedAt: 110,
    });

    expect(pushedDraft).toMatchObject({
      syncStatus: 'pushed',
      updatedAt: 100,
      pushedAt: 110,
    });
    expect(codexDraftStore.getDraft('book-1', 2)).toMatchObject({
      updatedAt: 100,
      pushedAt: 110,
    });
  });

  test('lists drafts for a single book in section order', () => {
    codexDraftStore.saveDraft({
      bookHash: 'book-1',
      sectionIndex: 5,
      html: '<p>Five</p>',
      text: 'Five',
    });
    codexDraftStore.saveDraft({
      bookHash: 'book-2',
      sectionIndex: 1,
      html: '<p>Other</p>',
      text: 'Other',
    });
    codexDraftStore.saveDraft({
      bookHash: 'book-1',
      sectionIndex: 1,
      html: '<p>One</p>',
      text: 'One',
    });

    expect(codexDraftStore.listBookDrafts('book-1').map((draft) => draft.sectionIndex)).toEqual([
      1, 5,
    ]);
  });

  test('lists repository drafts and pending repository drafts', () => {
    codexDraftStore.saveDraft({
      repositoryId: 'repo-1',
      bookHash: 'book-1',
      sectionIndex: 1,
      html: '<p>One</p>',
      text: 'One',
    });
    codexDraftStore.markDraftPushed(
      codexDraftStore.saveDraft({
        repositoryId: 'repo-1',
        bookHash: 'book-1',
        sectionIndex: 2,
        html: '<p>Two</p>',
        text: 'Two',
      }),
    );
    codexDraftStore.saveDraft({
      repositoryId: 'repo-2',
      bookHash: 'book-2',
      sectionIndex: 1,
      html: '<p>Other</p>',
      text: 'Other',
    });

    expect(codexDraftStore.listRepositoryDrafts('repo-1')).toHaveLength(2);
    expect(codexDraftStore.listPendingRepositoryDrafts('repo-1')).toHaveLength(1);
  });

  test('merges newer remote drafts without replacing newer local edits', () => {
    codexDraftStore.saveDraft({
      repositoryId: 'repo-1',
      bookHash: 'book-1',
      sectionIndex: 1,
      html: '<p>Local</p>',
      text: 'Local',
    });
    const localDraft = codexDraftStore.getDraft('book-1', 1)!;

    const mergedDrafts = codexDraftStore.mergeDrafts([
      {
        repositoryId: 'repo-1',
        bookHash: 'book-1',
        sectionIndex: 1,
        html: '<p>Older Remote</p>',
        text: 'Older Remote',
        updatedAt: localDraft.updatedAt - 1,
      },
      {
        repositoryId: 'repo-1',
        bookHash: 'book-1',
        sectionIndex: 2,
        html: '<p>New Remote</p>',
        text: 'New Remote',
        updatedAt: localDraft.updatedAt + 1,
      },
    ]);

    expect(mergedDrafts).toHaveLength(1);
    expect(codexDraftStore.getDraft('book-1', 1)?.text).toBe('Local');
    expect(codexDraftStore.getDraft('book-1', 2)?.text).toBe('New Remote');
  });
});
