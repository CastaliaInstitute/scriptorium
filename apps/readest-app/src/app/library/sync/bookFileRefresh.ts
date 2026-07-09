import { Book } from '@/types/book';
import { AppService } from '@/types/system';

export type BookFileRefreshCandidate = {
  oldBook: Book;
  remoteBook: Book;
};

export const shouldRedownloadBook = (oldBook: Book, remoteBook: Book) => {
  if (remoteBook.deletedAt || !remoteBook.uploadedAt) return false;
  if (!oldBook.downloadedAt) return true;
  if (remoteBook.uploadedAt > oldBook.downloadedAt) return true;
  return !!remoteBook.metaHash && remoteBook.metaHash !== oldBook.metaHash;
};

export const findBooksNeedingFileRefresh = (oldBooks: Book[], syncedBooks: Book[]) => {
  return oldBooks
    .map((oldBook) => {
      const remoteBook = syncedBooks.find((newBook) => newBook.hash === oldBook.hash);
      return remoteBook && shouldRedownloadBook(oldBook, remoteBook)
        ? { oldBook, remoteBook }
        : null;
    })
    .filter(Boolean) as BookFileRefreshCandidate[];
};

export const refreshSyncedBookFiles = async (
  appService: AppService | null | undefined,
  candidates: BookFileRefreshCandidate[],
  onProgress?: (progress: number) => void,
) => {
  const refreshedBookHashes = new Set<string>();

  for (let i = 0; i < candidates.length; i += 1) {
    const { remoteBook } = candidates[i]!;
    await appService?.downloadBook(remoteBook, false, true);
    refreshedBookHashes.add(remoteBook.hash);
    onProgress?.(Math.min((i + 1) / candidates.length, 1));
  }

  return refreshedBookHashes;
};

export const mergeSyncedBookAfterRefresh = (
  oldBook: Book,
  remoteBook: Book,
  refreshedBookHashes: Set<string>,
  syncedAt = Date.now(),
) => {
  const mergedBook =
    remoteBook.updatedAt >= oldBook.updatedAt
      ? { ...oldBook, ...remoteBook, syncedAt }
      : { ...remoteBook, ...oldBook, syncedAt };

  if (refreshedBookHashes.has(remoteBook.hash)) {
    mergedBook.downloadedAt = remoteBook.downloadedAt ?? syncedAt;
    mergedBook.coverDownloadedAt = remoteBook.coverDownloadedAt ?? mergedBook.coverDownloadedAt;
    mergedBook.coverImageUrl = remoteBook.coverImageUrl ?? mergedBook.coverImageUrl;
  }

  return mergedBook;
};
