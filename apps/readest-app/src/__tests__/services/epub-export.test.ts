import { beforeEach, describe, expect, test } from 'vitest';
import type { BookDoc } from '@/libs/document';
import { applyCodexDraftsToEpub, buildCodexEpubReplacements } from '@/services/castalia/epubExport';
import type { CodexDraft } from '@/services/castalia/codexDrafts';

const createTestEpub = async () => {
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'));
  await writer.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  );
  await writer.add(
    'OEBPS/chapter1.xhtml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body><p>Original</p></body>
</html>`),
  );
  await writer.add(
    'OEBPS/content.opf',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">test</dc:identifier>
    <dc:title>Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`),
  );
  const blob = await writer.close();
  return new File([blob], 'test.epub', { type: 'application/epub+zip' });
};

const bookDoc = {
  metadata: { title: 'Test', language: 'en' },
  rendition: {},
  dir: 'ltr',
  sections: [
    {
      id: 'OEBPS/chapter1.xhtml',
      cfi: '',
      size: 1,
      linear: 'yes',
      createDocument: async () => document,
    },
  ],
  splitTOCHref: () => [],
  getCover: async () => null,
} as unknown as BookDoc;

const draft: CodexDraft = {
  bookHash: 'book-1',
  sectionIndex: 0,
  html: '<p>Edited</p>',
  text: 'Edited',
  updatedAt: 1,
};

beforeEach(() => {
  localStorage.clear();
});

describe('epubExport', () => {
  test('maps Codex drafts to EPUB archive paths', () => {
    const replacements = buildCodexEpubReplacements(bookDoc, [draft]);

    expect(replacements.get('OEBPS/chapter1.xhtml')).toEqual(draft);
  });

  test('exports an EPUB with edited section body content', async () => {
    const file = await createTestEpub();
    const exported = await applyCodexDraftsToEpub(file, bookDoc, [draft]);
    const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(exported));

    try {
      const entries = await reader.getEntries();
      const chapter = entries.find(
        (entry) => entry.filename === 'OEBPS/chapter1.xhtml' && !entry.directory,
      );
      const text = chapter && 'getData' in chapter ? await chapter.getData(new TextWriter()) : '';

      expect(exported.name).toBe('test.codex.epub');
      expect(text).toContain('<p>Edited</p>');
      expect(text).not.toContain('<p>Original</p>');
    } finally {
      await reader.close();
    }
  });
});
