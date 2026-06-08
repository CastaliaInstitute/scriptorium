import { configureZip } from '@/utils/zip';
import type { CastaliaRepository } from './client';
import type { CodexDraft } from './codexDrafts';
import {
  CastaliaRepositoryArtifact,
  createCastaliaRepositoryArtifact,
  getCastaliaRepositoryArtifactFilename,
  serializeCastaliaRepositoryArtifact,
} from './repositoryArtifact';

export const CASTALIA_REPOSITORY_SNAPSHOT_SCHEMA = 'castalia.codex.git-snapshot.v1';

export interface CastaliaRepositorySnapshotManifest {
  schema: typeof CASTALIA_REPOSITORY_SNAPSHOT_SCHEMA;
  exportedAt: number;
  repositoryId: string;
  repositoryName: string;
  draftCount: number;
  files: string[];
}

export type CastaliaRepositorySnapshotFiles = Record<string, string>;

const slugifyPathPart = (value: string | undefined, fallback: string) => {
  const slug = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || fallback;
};

const getDraftBasePath = (draft: CodexDraft) => {
  const book = slugifyPathPart(draft.bookHash, 'book');
  const section = String(draft.sectionIndex).padStart(4, '0');
  const label = slugifyPathPart(draft.sectionLabel ?? draft.sectionHref, `section-${section}`);
  return `codex/drafts/${book}/${section}-${label}`;
};

const sortFiles = (files: CastaliaRepositorySnapshotFiles) =>
  Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));

export const createCastaliaRepositorySnapshotFiles = (
  repository: CastaliaRepository,
  drafts: CodexDraft[],
): CastaliaRepositorySnapshotFiles => {
  const artifact = createCastaliaRepositoryArtifact(repository, drafts);
  const files: CastaliaRepositorySnapshotFiles = {
    'codex/repository.json': JSON.stringify(repository, null, 2),
    [getCastaliaRepositoryArtifactFilename(repository)]:
      serializeCastaliaRepositoryArtifact(artifact),
  };

  for (const draft of drafts) {
    const basePath = getDraftBasePath(draft);
    files[`${basePath}.json`] = JSON.stringify(draft, null, 2);
    files[`${basePath}.xhtml`] = draft.html;
    files[`${basePath}.txt`] = draft.text;
  }

  const manifest: CastaliaRepositorySnapshotManifest = {
    schema: CASTALIA_REPOSITORY_SNAPSHOT_SCHEMA,
    exportedAt: artifact.exportedAt,
    repositoryId: repository.id,
    repositoryName: repository.name,
    draftCount: drafts.length,
    files: Object.keys(files).sort(),
  };
  files['codex/manifest.json'] = JSON.stringify(manifest, null, 2);

  return sortFiles(files);
};

export const createCastaliaRepositorySnapshotArtifact = (
  repository: CastaliaRepository,
  drafts: CodexDraft[],
): CastaliaRepositoryArtifact => createCastaliaRepositoryArtifact(repository, drafts);

export const getCastaliaRepositorySnapshotFilename = (repository: CastaliaRepository) => {
  const base = getCastaliaRepositoryArtifactFilename(repository).replace(
    /\.castalia-codex\.json$/,
    '',
  );
  return `${base || repository.id}.castalia-codex.zip`;
};

export const createCastaliaRepositorySnapshotZip = async (
  repository: CastaliaRepository,
  drafts: CodexDraft[],
): Promise<File> => {
  await configureZip();
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    extendedTimestamp: false,
  });
  const files = createCastaliaRepositorySnapshotFiles(repository, drafts);

  for (const [path, content] of Object.entries(files)) {
    await writer.add(path, new TextReader(content), {
      lastModDate: new Date(0),
    });
  }

  const blob = await writer.close();
  return new File([blob], getCastaliaRepositorySnapshotFilename(repository), {
    type: 'application/zip',
  });
};
