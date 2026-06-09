import { describe, expect, test, vi } from 'vitest';
import { createCodexEpubFile } from '@/services/castalia/epubCreate';

const readEpubEntries = async (file: File) => {
  const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const contents = new Map<string, string>();
    for (const entry of entries) {
      if (entry.directory || !entry.getData) continue;
      contents.set(entry.filename, await entry.getData(new TextWriter()));
    }
    return contents;
  } finally {
    await reader.close();
  }
};

describe('createCodexEpubFile', () => {
  test('creates a minimal editable EPUB package', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

    const file = await createCodexEpubFile({
      title: 'My Codex',
      author: 'Daniel',
      bodyHtml: '<h1>My Codex</h1><p>First paragraph.</p>',
    });
    const entries = await readEpubEntries(file);

    expect(file.name).toBe('My-Codex.epub');
    expect(file.type).toBe('application/epub+zip');
    expect(entries.get('mimetype')).toBe('application/epub+zip');
    expect(entries.get('META-INF/container.xml')).toContain('EPUB/package.opf');
    expect(entries.get('EPUB/package.opf')).toContain('<dc:title>My Codex</dc:title>');
    expect(entries.get('EPUB/package.opf')).toContain('<dc:creator>Daniel</dc:creator>');
    expect(entries.get('EPUB/nav.xhtml')).toContain('chapter-1.xhtml');
    expect(entries.get('EPUB/chapter-1.xhtml')).toContain('<p>First paragraph.</p>');
  });

  test('escapes metadata and sanitizes filenames', async () => {
    const file = await createCodexEpubFile({
      title: 'A <B> & C: Draft?',
      author: 'D "E"',
    });
    const entries = await readEpubEntries(file);

    expect(file.name).toBe('A-B-&-C-Draft.epub');
    expect(entries.get('EPUB/package.opf')).toContain(
      '<dc:title>A &lt;B&gt; &amp; C: Draft?</dc:title>',
    );
    expect(entries.get('EPUB/package.opf')).toContain('<dc:creator>D &quot;E&quot;</dc:creator>');
    expect(entries.get('EPUB/chapter-1.xhtml')).toContain('<h1>A &lt;B&gt; &amp; C: Draft?</h1>');
  });
});
