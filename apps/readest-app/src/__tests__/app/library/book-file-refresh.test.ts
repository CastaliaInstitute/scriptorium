import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import {
  findBooksNeedingFileRefresh,
  mergeSyncedBookAfterRefresh,
  refreshSyncedBookFiles,
  shouldRedownloadBook,
} from '@/app/library/sync/bookFileRefresh';

const book = (overrides: Partial<Book> = {}): Book =>
  ({
    hash: 'book-1',
    metaHash: 'meta-1',
    format: 'EPUB',
    title: 'Absinthe',
    author: 'Daniel McShan',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Book;

describe('bookFileRefresh', () => {
  it('does not refresh deleted or never-uploaded remote books', () => {
    const oldBook = book({ downloadedAt: 100 });

    expect(shouldRedownloadBook(oldBook, book({ deletedAt: 200, uploadedAt: 300 }))).toBe(false);
    expect(shouldRedownloadBook(oldBook, book({ uploadedAt: null }))).toBe(false);
  });

  it('refreshes existing synced books when the local file has never been downloaded', () => {
    expect(shouldRedownloadBook(book({ downloadedAt: null }), book({ uploadedAt: 100 }))).toBe(
      true,
    );
  });

  it('refreshes existing synced books when the remote upload is newer', () => {
    expect(shouldRedownloadBook(book({ downloadedAt: 100 }), book({ uploadedAt: 200 }))).toBe(true);
  });

  it('refreshes existing synced books when metadata hash changes', () => {
    expect(
      shouldRedownloadBook(
        book({ downloadedAt: 200, metaHash: 'old-meta' }),
        book({ uploadedAt: 100, metaHash: 'new-meta' }),
      ),
    ).toBe(true);
  });

  it('finds refresh candidates by matching local and remote book hash', () => {
    const candidates = findBooksNeedingFileRefresh(
      [book({ hash: 'book-1', downloadedAt: 100 }), book({ hash: 'book-2', downloadedAt: 300 })],
      [book({ hash: 'book-1', uploadedAt: 200 }), book({ hash: 'book-3', uploadedAt: 400 })],
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.oldBook.hash).toBe('book-1');
    expect(candidates[0]?.remoteBook.hash).toBe('book-1');
  });

  it('redownloads refresh candidates and reports progress', async () => {
    const downloadBook = vi.fn().mockResolvedValue(undefined);
    const progress = vi.fn();

    const refreshed = await refreshSyncedBookFiles(
      { downloadBook } as unknown as Parameters<typeof refreshSyncedBookFiles>[0],
      [
        { oldBook: book({ hash: 'book-1' }), remoteBook: book({ hash: 'book-1' }) },
        { oldBook: book({ hash: 'book-2' }), remoteBook: book({ hash: 'book-2' }) },
      ],
      progress,
    );

    expect(downloadBook).toHaveBeenCalledTimes(2);
    expect(downloadBook).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ hash: 'book-1' }),
      false,
      true,
    );
    expect(downloadBook).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ hash: 'book-2' }),
      false,
      true,
    );
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(progress).toHaveBeenCalledWith(1);
    expect([...refreshed]).toEqual(['book-1', 'book-2']);
  });

  it('preserves local metadata after redownloading a changed remote book', () => {
    const merged = mergeSyncedBookAfterRefresh(
      book({
        hash: 'book-1',
        title: 'Local title',
        updatedAt: 500,
        downloadedAt: 100,
        coverDownloadedAt: 120,
        coverImageUrl: 'local-cover-url',
      }),
      book({
        hash: 'book-1',
        title: 'Remote title',
        updatedAt: 400,
        uploadedAt: 800,
        downloadedAt: null,
        coverDownloadedAt: null,
        coverImageUrl: null,
      }),
      new Set(['book-1']),
      900,
    );

    expect(merged.title).toBe('Local title');
    expect(merged.uploadedAt).toBe(800);
    expect(merged.downloadedAt).toBe(900);
    expect(merged.coverDownloadedAt).toBe(120);
    expect(merged.coverImageUrl).toBe('local-cover-url');
    expect(merged.syncedAt).toBe(900);
  });

  it('accepts newer remote metadata after redownloading a changed remote book', () => {
    const merged = mergeSyncedBookAfterRefresh(
      book({
        hash: 'book-1',
        title: 'Local title',
        updatedAt: 300,
        downloadedAt: 100,
        coverDownloadedAt: 120,
        coverImageUrl: 'local-cover-url',
      }),
      book({
        hash: 'book-1',
        title: 'Remote title',
        updatedAt: 400,
        uploadedAt: 800,
        downloadedAt: 850,
        coverDownloadedAt: 860,
        coverImageUrl: 'remote-cover-url',
      }),
      new Set(['book-1']),
      900,
    );

    expect(merged.title).toBe('Remote title');
    expect(merged.uploadedAt).toBe(800);
    expect(merged.downloadedAt).toBe(850);
    expect(merged.coverDownloadedAt).toBe(860);
    expect(merged.coverImageUrl).toBe('remote-cover-url');
    expect(merged.syncedAt).toBe(900);
  });
});
