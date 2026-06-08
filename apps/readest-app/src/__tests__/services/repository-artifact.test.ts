import { describe, expect, test } from 'vitest';
import type { CastaliaRepository } from '@/services/castalia/client';
import type { CodexDraft } from '@/services/castalia/codexDrafts';
import {
  CASTALIA_REPOSITORY_ARTIFACT_SCHEMA,
  createCastaliaRepositoryArtifact,
  getCastaliaRepositoryArtifactFilename,
  parseCastaliaRepositoryArtifact,
  serializeCastaliaRepositoryArtifact,
} from '@/services/castalia/repositoryArtifact';
import {
  CASTALIA_REPOSITORY_SNAPSHOT_SCHEMA,
  createCastaliaRepositorySnapshotFiles,
  createCastaliaRepositorySnapshotZip,
  getCastaliaRepositorySnapshotFilename,
} from '@/services/castalia/repositorySnapshot';

const repository: CastaliaRepository = {
  id: 'repo-1',
  name: 'Scriptorium Drafts',
  provider: 'local',
  role: 'owner',
};

const draft: CodexDraft = {
  repositoryId: 'repo-1',
  bookHash: 'book-1',
  sectionIndex: 1,
  sectionHref: 'OEBPS/chapter1.xhtml',
  html: '<p>Edited</p>',
  text: 'Edited',
  updatedAt: 1,
};

describe('repositoryArtifact', () => {
  test('serializes and parses a repository artifact', () => {
    const artifact = createCastaliaRepositoryArtifact(repository, [draft]);
    const parsed = parseCastaliaRepositoryArtifact(serializeCastaliaRepositoryArtifact(artifact));

    expect(parsed.schema).toBe(CASTALIA_REPOSITORY_ARTIFACT_SCHEMA);
    expect(parsed.repository).toEqual(repository);
    expect(parsed.drafts).toEqual([draft]);
  });

  test('builds a stable artifact filename from repository name', () => {
    expect(getCastaliaRepositoryArtifactFilename(repository)).toBe(
      'scriptorium-drafts.castalia-codex.json',
    );
  });

  test('rejects unsupported artifact schemas', () => {
    expect(() =>
      parseCastaliaRepositoryArtifact(
        JSON.stringify({
          schema: 'other',
          repository,
          drafts: [draft],
        }),
      ),
    ).toThrow('Unsupported Castalia repository artifact schema');
  });

  test('creates a Git-friendly repository snapshot file tree', () => {
    const files = createCastaliaRepositorySnapshotFiles(repository, [draft]);
    const manifest = JSON.parse(files['codex/manifest.json']!);

    expect(manifest).toMatchObject({
      schema: CASTALIA_REPOSITORY_SNAPSHOT_SCHEMA,
      repositoryId: 'repo-1',
      draftCount: 1,
    });
    expect(files['codex/repository.json']).toContain('Scriptorium Drafts');
    expect(files['scriptorium-drafts.castalia-codex.json']).toContain(
      CASTALIA_REPOSITORY_ARTIFACT_SCHEMA,
    );
    expect(Object.keys(files)).toContain('codex/drafts/book-1/0001-oebps-chapter1.xhtml.json');
    expect(Object.keys(files)).toContain('codex/drafts/book-1/0001-oebps-chapter1.xhtml.xhtml');
    expect(Object.keys(files)).toContain('codex/drafts/book-1/0001-oebps-chapter1.xhtml.txt');
  });

  test('builds a stable snapshot filename', () => {
    expect(getCastaliaRepositorySnapshotFilename(repository)).toBe(
      'scriptorium-drafts.castalia-codex.zip',
    );
  });

  test('creates a repository snapshot zip', async () => {
    const file = await createCastaliaRepositorySnapshotZip(repository, [draft]);
    const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file));
    const entries = await reader.getEntries();
    const manifestEntry = entries.find((entry) => entry.filename === 'codex/manifest.json');
    const manifest =
      manifestEntry && 'getData' in manifestEntry
        ? await manifestEntry.getData(new TextWriter())
        : '';

    expect(file.name).toBe('scriptorium-drafts.castalia-codex.zip');
    expect(manifest).toContain(CASTALIA_REPOSITORY_SNAPSHOT_SCHEMA);
    await reader.close();
  });
});
