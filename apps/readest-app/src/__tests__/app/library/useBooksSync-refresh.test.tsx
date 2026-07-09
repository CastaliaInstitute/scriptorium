import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import { SYNC_BOOKS_INTERVAL_SEC } from '@/services/constants';

const h = vi.hoisted(() => {
  const book = (overrides: Partial<Book> = {}): Book =>
    ({
      hash: 'absinthe',
      metaHash: 'meta-old',
      format: 'EPUB',
      title: 'Absinthe',
      author: 'Daniel McShan',
      createdAt: 1,
      updatedAt: 100,
      uploadedAt: 200,
      downloadedAt: 300,
      coverDownloadedAt: 310,
      coverImageUrl: 'local-cover',
      ...overrides,
    }) as Book;

  const libraryState = {
    library: [] as Book[],
    isSyncing: false,
    libraryLoaded: true,
    setLibrary: vi.fn((books: Book[]) => {
      libraryState.library = books;
      libraryState.libraryLoaded = true;
    }),
    setIsSyncing: vi.fn((syncing: boolean) => {
      libraryState.isSyncing = syncing;
    }),
    setSyncProgress: vi.fn(),
  };

  const useLibraryStoreMock = () => libraryState;
  useLibraryStoreMock.getState = () => libraryState;

  return {
    book,
    libraryState,
    useLibraryStoreMock,
    user: { id: 'reader-1' },
    syncedBooks: [] as Book[],
    lastSyncedAtBooks: 1,
    syncBooks: vi.fn(async () => 0),
    appService: {
      downloadBook: vi.fn(async (bookToDownload: Book) => {
        bookToDownload.downloadedAt = 901;
        bookToDownload.coverDownloadedAt = 902;
        bookToDownload.coverImageUrl = 'remote-cover';
      }),
      downloadBookCovers: vi.fn(async () => {}),
      generateCoverImageUrl: vi.fn(async () => 'generated-cover'),
      saveLibraryBooks: vi.fn(async () => {}),
    },
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({
    useSyncInited: true,
    syncedBooks: h.syncedBooks,
    syncBooks: h.syncBooks,
    lastSyncedAtBooks: h.lastSyncedAtBooks,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (template: string, values?: Record<string, unknown>) =>
    values?.['count'] !== undefined
      ? template.replace('{{count}}', String(values['count']))
      : template,
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: h.useLibraryStoreMock,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

import { useBooksSync } from '@/app/library/hooks/useBooksSync';

describe('useBooksSync remote book refresh', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(900);
    h.lastSyncedAtBooks = 1;
    h.libraryState.library = [
      h.book({
        title: 'Local Absinthe',
        updatedAt: 500,
        metaHash: 'meta-old',
        uploadedAt: 200,
        downloadedAt: 300,
        coverDownloadedAt: 310,
        coverImageUrl: 'local-cover',
      }),
    ];
    h.libraryState.isSyncing = false;
    h.libraryState.libraryLoaded = true;
    h.syncedBooks = [
      h.book({
        title: 'Remote Absinthe',
        updatedAt: 400,
        metaHash: 'meta-new',
        uploadedAt: 800,
        downloadedAt: null,
        coverDownloadedAt: null,
        coverImageUrl: null,
      }),
    ];
    h.syncBooks.mockClear();
    h.appService.downloadBook.mockClear();
    h.appService.downloadBookCovers.mockClear();
    h.appService.generateCoverImageUrl.mockClear();
    h.appService.saveLibraryBooks.mockClear();
    h.libraryState.setLibrary.mockClear();
    h.libraryState.setIsSyncing.mockClear();
    h.libraryState.setSyncProgress.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('redownloads and persists an existing synced EPUB when remote metadata changes', async () => {
    renderHook(() => useBooksSync());

    await waitFor(() => {
      expect(h.appService.downloadBook).toHaveBeenCalledWith(
        expect.objectContaining({ hash: 'absinthe', metaHash: 'meta-new' }),
        false,
        true,
      );
    });

    expect(h.libraryState.setIsSyncing).toHaveBeenNthCalledWith(1, true);
    expect(h.libraryState.setIsSyncing).toHaveBeenLastCalledWith(false);
    expect(h.libraryState.setSyncProgress).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(h.libraryState.setLibrary).toHaveBeenCalled();
      expect(h.appService.saveLibraryBooks).toHaveBeenCalled();
    });

    const refreshedBook = h.libraryState.library[0]!;
    expect(refreshedBook.hash).toBe('absinthe');
    expect(refreshedBook.title).toBe('Local Absinthe');
    expect(refreshedBook.metaHash).toBe('meta-new');
    expect(refreshedBook.uploadedAt).toBe(800);
    expect(refreshedBook.downloadedAt).toBe(901);
    expect(refreshedBook.coverDownloadedAt).toBe(902);
    expect(refreshedBook.coverImageUrl).toBe('remote-cover');
    expect(refreshedBook.syncedAt).toBe(900);
  });

  test('periodically pulls cloud book changes while the library is open', async () => {
    h.lastSyncedAtBooks = 800;
    h.libraryState.library = [
      h.book({
        updatedAt: 500,
        metaHash: 'meta-old',
        uploadedAt: 200,
        downloadedAt: 300,
      }),
    ];
    h.syncedBooks = [];
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => 123 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);

    renderHook(() => useBooksSync());

    await waitFor(() => {
      expect(h.syncBooks).toHaveBeenCalledWith([], 'pull', undefined);
    });
    h.syncBooks.mockClear();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      SYNC_BOOKS_INTERVAL_SEC * 1000,
    );
    const intervalCallback = setIntervalSpy.mock.calls[0]?.[0] as () => void;
    intervalCallback();

    await waitFor(() => {
      expect(h.syncBooks).toHaveBeenCalledWith([], 'pull', undefined);
    });
  });

  test('pulls cloud book changes when the app returns online or foreground', async () => {
    h.lastSyncedAtBooks = 800;
    h.syncedBooks = [];

    renderHook(() => useBooksSync());

    await waitFor(() => {
      expect(h.syncBooks).toHaveBeenCalledWith([], 'pull', undefined);
    });
    h.syncBooks.mockClear();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(h.syncBooks).toHaveBeenCalledWith([], 'pull', undefined);
    });

    h.syncBooks.mockClear();
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => {
      expect(h.syncBooks).toHaveBeenCalledWith([], 'pull', undefined);
    });
  });
});
