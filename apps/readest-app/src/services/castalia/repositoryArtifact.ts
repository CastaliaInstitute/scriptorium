import type { CastaliaRepository } from './client';
import type { CodexDraft } from './codexDrafts';

export const CASTALIA_REPOSITORY_ARTIFACT_SCHEMA = 'castalia.codex.repository.v1';

export interface CastaliaRepositoryArtifact {
  schema: typeof CASTALIA_REPOSITORY_ARTIFACT_SCHEMA;
  exportedAt: number;
  repository: CastaliaRepository;
  drafts: CodexDraft[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isRepository = (value: unknown): value is CastaliaRepository => {
  if (!isRecord(value)) return false;
  return typeof value['id'] === 'string' && typeof value['name'] === 'string';
};

const isCodexDraft = (value: unknown): value is CodexDraft => {
  if (!isRecord(value)) return false;
  return (
    typeof value['bookHash'] === 'string' &&
    typeof value['sectionIndex'] === 'number' &&
    typeof value['html'] === 'string' &&
    typeof value['text'] === 'string' &&
    typeof value['updatedAt'] === 'number'
  );
};

export const createCastaliaRepositoryArtifact = (
  repository: CastaliaRepository,
  drafts: CodexDraft[],
): CastaliaRepositoryArtifact => ({
  schema: CASTALIA_REPOSITORY_ARTIFACT_SCHEMA,
  exportedAt: Date.now(),
  repository,
  drafts,
});

export const serializeCastaliaRepositoryArtifact = (artifact: CastaliaRepositoryArtifact) =>
  JSON.stringify(artifact, null, 2);

export const parseCastaliaRepositoryArtifact = (raw: string): CastaliaRepositoryArtifact => {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Invalid Castalia repository artifact');
  }
  if (parsed['schema'] !== CASTALIA_REPOSITORY_ARTIFACT_SCHEMA) {
    throw new Error('Unsupported Castalia repository artifact schema');
  }
  if (!isRepository(parsed['repository'])) {
    throw new Error('Invalid Castalia repository artifact repository');
  }
  const drafts = parsed['drafts'];
  if (!Array.isArray(drafts) || drafts.some((draft) => !isCodexDraft(draft))) {
    throw new Error('Invalid Castalia repository artifact drafts');
  }

  return {
    schema: CASTALIA_REPOSITORY_ARTIFACT_SCHEMA,
    exportedAt: typeof parsed['exportedAt'] === 'number' ? parsed['exportedAt'] : Date.now(),
    repository: parsed['repository'],
    drafts,
  };
};

export const getCastaliaRepositoryArtifactFilename = (repository: CastaliaRepository) => {
  const slug = repository.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || repository.id}.castalia-codex.json`;
};
