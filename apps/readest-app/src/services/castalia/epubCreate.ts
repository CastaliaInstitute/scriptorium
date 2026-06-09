import { configureZip } from '@/utils/zip';

const EPUB_MIME_TYPE = 'application/epub+zip';

export interface CreateCodexEpubInput {
  title: string;
  author?: string;
  language?: string;
  bodyHtml?: string;
}

const DEFAULT_TITLE = 'Untitled Codex';
const DEFAULT_AUTHOR = 'Castalia Institute';
const DEFAULT_LANGUAGE = 'en';

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');

const sanitizeFilename = (value: string) => {
  const filename = normalizeWhitespace(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return filename || 'untitled-codex';
};

const createIdentifier = () => {
  if (globalThis.crypto?.randomUUID) {
    return `urn:uuid:${globalThis.crypto.randomUUID()}`;
  }
  return `urn:castalia:codex:${Date.now().toString(36)}`;
};

const normalizeBodyHtml = (input: CreateCodexEpubInput) => {
  const bodyHtml = input.bodyHtml?.trim();
  if (bodyHtml) return bodyHtml;
  return `<h1>${escapeXml(normalizeWhitespace(input.title) || DEFAULT_TITLE)}</h1>\n<p></p>`;
};

export const createCodexEpubFile = async (input: CreateCodexEpubInput): Promise<File> => {
  const title = normalizeWhitespace(input.title) || DEFAULT_TITLE;
  const author = normalizeWhitespace(input.author ?? '') || DEFAULT_AUTHOR;
  const language = normalizeWhitespace(input.language ?? '') || DEFAULT_LANGUAGE;
  const identifier = createIdentifier();
  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bodyHtml = normalizeBodyHtml({ ...input, title });

  await configureZip();
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter(EPUB_MIME_TYPE), {
    extendedTimestamp: false,
  });

  await writer.add('mimetype', new TextReader(EPUB_MIME_TYPE), { level: 0 });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  );
  await writer.add(
    'EPUB/package.opf',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <meta property="dcterms:modified">${createdAt}</meta>
    <meta property="dcterms:type">Castalia Codex</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>`),
  );
  await writer.add(
    'EPUB/nav.xhtml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(
      language,
    )}">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${escapeXml(title)}</h1>
      <ol>
        <li><a href="chapter-1.xhtml">${escapeXml(title)}</a></li>
      </ol>
    </nav>
  </body>
</html>`),
  );
  await writer.add(
    'EPUB/chapter-1.xhtml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
${bodyHtml}
  </body>
</html>`),
  );

  const blob = await writer.close();
  return new File([blob], `${sanitizeFilename(title)}.epub`, { type: EPUB_MIME_TYPE });
};
