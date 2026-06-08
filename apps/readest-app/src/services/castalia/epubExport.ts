import type { BookDoc } from '@/libs/document';
import { configureZip } from '@/utils/zip';
import type { CodexDraft } from './codexDrafts';

const EPUB_MIME_TYPE = 'application/epub+zip';

const getSectionArchivePath = (bookDoc: BookDoc, draft: CodexDraft) => {
  const section = bookDoc.sections[draft.sectionIndex];
  return draft.sectionHref ?? section?.href ?? section?.id ?? null;
};

const normalizeArchivePath = (path: string) => decodeURI(path).replace(/^\/+/, '').split('#')[0]!;

const replaceBodyHtml = (source: string, bodyHtml: string) => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(source, 'application/xhtml+xml');
  const xmlBody = xmlDoc.getElementsByTagName('body')[0];
  if (xmlBody && !xmlDoc.querySelector('parsererror')) {
    xmlBody.innerHTML = bodyHtml;
    return new XMLSerializer().serializeToString(xmlDoc);
  }

  const htmlDoc = parser.parseFromString(source, 'text/html');
  htmlDoc.body.innerHTML = bodyHtml;
  return `<!DOCTYPE html>\n${htmlDoc.documentElement.outerHTML}`;
};

export const buildCodexEpubReplacements = (bookDoc: BookDoc, drafts: CodexDraft[]) => {
  const replacements = new Map<string, CodexDraft>();
  for (const draft of drafts) {
    const archivePath = getSectionArchivePath(bookDoc, draft);
    if (!archivePath) continue;
    replacements.set(normalizeArchivePath(archivePath), draft);
  }
  return replacements;
};

export const applyCodexDraftsToEpub = async (
  file: File,
  bookDoc: BookDoc,
  drafts: CodexDraft[],
): Promise<File> => {
  const replacements = buildCodexEpubReplacements(bookDoc, drafts);
  if (replacements.size === 0) {
    throw new Error('No Codex drafts can be mapped to EPUB sections');
  }

  await configureZip();
  const { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } = await import(
    '@zip.js/zip.js'
  );
  const reader = new ZipReader(new BlobReader(file));
  const writer = new ZipWriter(new BlobWriter(EPUB_MIME_TYPE), {
    extendedTimestamp: false,
  });

  try {
    const entries = await reader.getEntries();
    for (const entry of entries) {
      if (entry.directory) continue;
      const filename = normalizeArchivePath(entry.filename);
      const options = {
        lastAccessDate: new Date(0),
        lastModDate: entry.lastModDate ?? new Date(0),
        level: filename === 'mimetype' ? 0 : undefined,
      };
      const draft = replacements.get(filename);
      if (draft) {
        const source = await entry.getData!(new TextWriter());
        await writer.add(filename, new TextReader(replaceBodyHtml(source, draft.html)), options);
        continue;
      }

      const blob = await entry.getData!(new BlobWriter());
      await writer.add(filename, new BlobReader(blob), options);
    }

    const blob = await writer.close();
    const filename = file.name.replace(/\.epub$/i, '') || 'codex';
    return new File([blob], `${filename}.codex.epub`, { type: EPUB_MIME_TYPE });
  } finally {
    await reader.close();
  }
};
