import fs from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

type StoredBook = {
  hash: string;
  metaHash?: string;
  format: string;
  title: string;
  sourceTitle?: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  uploadedAt?: number | null;
  downloadedAt?: number | null;
};

const readStoredLibrary = async (page: Page) =>
  page.evaluate<StoredBook[]>(async () => {
    const request = indexedDB.open('AppFileSystem', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('files', 'readonly');
    const store = transaction.objectStore('files');
    const getRequest = store.get('Readest/Books/library.json');
    const record = await new Promise<{ content?: string } | undefined>((resolve, reject) => {
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    });
    return record?.content ? JSON.parse(record.content) : [];
  });

test.describe('Synced book refresh', () => {
  test('redownloads an existing EPUB when sync reports newer remote file metadata', async ({
    page,
  }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await expect(library.emptyState).toBeVisible();

    await library.importBook(SAMPLE_EPUB);
    await expect(library.bookCards()).toHaveCount(1);

    const [localBook] = await readStoredLibrary(page);
    expect(localBook?.hash).toBeTruthy();

    const remoteUploadedAt = Date.now() + 60_000;
    const remoteMetaHash = `${localBook!.metaHash ?? localBook!.hash}-remote`;
    const sampleBytes = await fs.readFile(SAMPLE_EPUB);

    await page.route('**/api/sync**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            books: [
              {
                user_id: 'reader-1',
                book_hash: localBook!.hash,
                meta_hash: remoteMetaHash,
                format: localBook!.format,
                title: localBook!.title,
                source_title: localBook!.sourceTitle ?? localBook!.title,
                author: localBook!.author,
                created_at: new Date(localBook!.createdAt).toISOString(),
                updated_at: new Date(localBook!.updatedAt - 1).toISOString(),
                deleted_at: null,
                uploaded_at: new Date(remoteUploadedAt).toISOString(),
              },
            ],
            configs: null,
            notes: null,
          }),
        });
        return;
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ books: [], configs: null, notes: null }),
      });
    });

    await page.route('**/api/storage/download**', async (route) => {
      const url = new URL(route.request().url());
      const fileKey = url.searchParams.get('fileKey') ?? '';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          downloadUrl: fileKey.endsWith('.epub') ? 'http://localhost:3000/__e2e__/remote.epub' : '',
        }),
      });
    });

    await page.route('**/__e2e__/remote.epub', async (route) => {
      await route.fulfill({
        contentType: 'application/epub+zip',
        body: sampleBytes,
      });
    });

    await page.evaluate(() => {
      localStorage.setItem('demoBooksFetched', 'true');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem(
        'user',
        JSON.stringify({ id: 'reader-1', email: 'reader@example.test' }),
      );
    });
    await library.goto();

    await expect
      .poll(async () => {
        const [book] = await readStoredLibrary(page);
        return {
          metaHash: book?.metaHash,
          uploadedAt: book?.uploadedAt,
          downloadedAt: book?.downloadedAt,
        };
      })
      .toMatchObject({
        metaHash: remoteMetaHash,
        uploadedAt: remoteUploadedAt,
      });
  });
});
