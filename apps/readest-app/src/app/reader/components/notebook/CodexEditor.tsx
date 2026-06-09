import React, { useEffect, useMemo, useState } from 'react';
import { Download, Link2, Save, Trash2, Upload, Wand2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { castaliaClient } from '@/services/castalia/client';
import { CodexDraft, codexDraftStore } from '@/services/castalia/codexDrafts';
import {
  CodexLink,
  CodexLinkRelation,
  CodexPassageRef,
  codexLinkStore,
} from '@/services/castalia/codexLinks';
import { applyCodexDraftsToEpub } from '@/services/castalia/epubExport';
import TextButton from '@/components/TextButton';

interface CodexEditorProps {
  bookKey: string;
}

const getReadableHtml = (doc: Document | null) => doc?.body?.innerHTML.trim() ?? '';
const getReadableText = (doc: Document | null) => doc?.body?.innerText.trim() ?? '';
const getTextFromHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body.innerText.trim();
};

const relationOptions: CodexLinkRelation[] = [
  'references',
  'echoes',
  'supports',
  'contradicts',
  'expands',
  'influenced_by',
];

const getRelationLabel = (relation: CodexLinkRelation) =>
  relation
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
};

const CodexEditor: React.FC<CodexEditorProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { token } = useAuth();
  const { getBookData } = useBookDataStore();
  const libraryBooks = useLibraryStore((state) => state.visibleLibrary);
  const { getProgress, getView } = useReaderStore();
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);
  const view = getView(bookKey);
  const bookHash = bookKey.split('-')[0]!;
  const sectionIndex = view?.renderer?.primaryIndex ?? progress?.index ?? 0;
  const sectionLabel = progress?.sectionLabel;

  const activeDoc = useMemo(() => {
    const contents = view?.renderer?.getContents() ?? [];
    return (
      contents.find((content) => content.index === sectionIndex)?.doc ?? contents[0]?.doc ?? null
    );
  }, [sectionIndex, view]);
  const sectionHref =
    bookData?.bookDoc?.sections[sectionIndex]?.href ??
    bookData?.bookDoc?.sections[sectionIndex]?.id;

  const [draftHtml, setDraftHtml] = useState('');
  const [message, setMessage] = useState('');
  const [savedDraft, setSavedDraft] = useState<CodexDraft | null>(null);
  const [targetBookHash, setTargetBookHash] = useState('');
  const [targetPassageLabel, setTargetPassageLabel] = useState('');
  const [linkNote, setLinkNote] = useState('');
  const [linkRelation, setLinkRelation] = useState<CodexLinkRelation>('references');
  const [sectionLinks, setSectionLinks] = useState<CodexLink[]>([]);
  const activeRepository = castaliaClient.getActiveRepository();
  const syncStatus = castaliaClient.getRepositorySyncStatus(activeRepository);
  const targetBooks = useMemo(
    () => libraryBooks.filter((book) => !book.deletedAt && book.hash !== bookHash),
    [bookHash, libraryBooks],
  );
  const sourcePassage = useMemo<CodexPassageRef>(
    () => ({
      bookHash,
      bookTitle: bookData?.book?.title,
      sectionIndex,
      sectionLabel,
      sectionHref,
    }),
    [bookData?.book?.title, bookHash, sectionHref, sectionIndex, sectionLabel],
  );

  useEffect(() => {
    if (!bookData?.book || bookData.book.format !== 'EPUB') {
      setDraftHtml('');
      return;
    }
    const savedDraft = codexDraftStore.getDraft(bookHash, sectionIndex);
    setSavedDraft(savedDraft);
    setDraftHtml(savedDraft?.html ?? getReadableHtml(activeDoc));
    setMessage('');
  }, [activeDoc, bookData?.book, bookHash, sectionIndex]);

  useEffect(() => {
    setSectionLinks(codexLinkStore.listSourceLinks(sourcePassage));
  }, [sourcePassage]);

  useEffect(() => {
    if (!targetBookHash || !targetBooks.some((book) => book.hash === targetBookHash)) {
      setTargetBookHash(targetBooks[0]?.hash ?? '');
    }
  }, [targetBookHash, targetBooks]);

  const handleSaveDraft = () => {
    if (!bookData?.book || bookData.book.format !== 'EPUB') return;
    const repository = castaliaClient.getActiveRepository();
    const draft = codexDraftStore.saveDraft({
      repositoryId: repository?.id,
      bookHash,
      sectionIndex,
      sectionLabel,
      sectionHref,
      html: draftHtml,
      text: getTextFromHtml(draftHtml) || (activeDoc ? getReadableText(activeDoc) : ''),
    });
    setSavedDraft(draft);
    setMessage(_('Draft saved'));
    return draft;
  };

  const handleApplyToView = () => {
    if (!activeDoc?.body) return;
    activeDoc.body.innerHTML = draftHtml;
    handleSaveDraft();
    setMessage(_('Draft applied to current view'));
  };

  const handlePushDraft = async () => {
    if (!token) return;
    const draft = savedDraft ?? handleSaveDraft();
    if (!draft?.repositoryId) {
      setMessage(_('Select a Castalia repository first'));
      return;
    }
    if (!syncStatus.canPushDrafts) {
      setMessage(_(syncStatus.reason ?? 'Repository sync is not available'));
      return;
    }
    try {
      const remoteDraft = await castaliaClient.pushCodexDraft(token, draft);
      const pushedDraft = codexDraftStore.markDraftPushed(remoteDraft ?? draft);
      setSavedDraft(pushedDraft);
      setMessage(_('Draft pushed'));
    } catch (error) {
      console.error('Failed to push Codex draft:', error);
      const errorDraft = codexDraftStore.markDraftError(draft);
      setSavedDraft(errorDraft);
      setMessage(_('Unable to push draft'));
    }
  };

  const handleExportEpub = async () => {
    if (!bookData?.file || !bookData.bookDoc) return;
    const draft = savedDraft ?? handleSaveDraft();
    const drafts = codexDraftStore.listBookDrafts(bookHash);
    const exportDrafts = draft ? [draft, ...drafts.filter((item) => item !== draft)] : drafts;
    try {
      const file = await applyCodexDraftsToEpub(bookData.file, bookData.bookDoc, exportDrafts);
      downloadFile(file);
      setMessage(_('Edited EPUB exported'));
    } catch (error) {
      console.error('Failed to export Codex EPUB:', error);
      setMessage(_('Unable to export edited EPUB'));
    }
  };

  const refreshSectionLinks = () => {
    setSectionLinks(codexLinkStore.listSourceLinks(sourcePassage));
  };

  const handleAddLink = () => {
    const targetBook = targetBooks.find((book) => book.hash === targetBookHash);
    if (!targetBook) {
      setMessage(_('Select a target book'));
      return;
    }
    codexLinkStore.saveLink({
      relation: linkRelation,
      source: sourcePassage,
      target: {
        bookHash: targetBook.hash,
        bookTitle: targetBook.title,
        passageLabel: targetPassageLabel.trim() || undefined,
      },
      note: linkNote,
    });
    setTargetPassageLabel('');
    setLinkNote('');
    refreshSectionLinks();
    setMessage(_('Reference linked'));
  };

  const handleDeleteLink = (id: string) => {
    codexLinkStore.deleteLink(id);
    refreshSectionLinks();
    setMessage(_('Reference removed'));
  };

  if (!bookData?.book || bookData.book.format !== 'EPUB') {
    return (
      <div className='flex flex-grow items-center justify-center overflow-y-auto px-3'>
        <p className='text-base-content/70 text-center text-sm'>
          {_('Codex editing is available for EPUB books.')}
        </p>
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3'>
      <div className='pt-2'>
        <p className='content font-size-base'>{_('Codex Draft')}</p>
        <p className='text-base-content/60 line-clamp-2 text-xs'>
          {sectionLabel || _('Current EPUB section')}
        </p>
      </div>
      <textarea
        className='textarea textarea-bordered bg-base-100 min-h-[320px] flex-1 resize-none font-mono text-xs leading-relaxed'
        value={draftHtml}
        onChange={(event) => setDraftHtml(event.target.value)}
        spellCheck={false}
        aria-label={_('Codex Draft')}
      />
      <div className='border-base-300 flex flex-col gap-2 border-t pt-3'>
        <div>
          <p className='text-sm font-medium'>{_('Cross-book References')}</p>
          <p className='text-base-content/60 line-clamp-1 text-xs'>
            {sectionLabel || _('Current EPUB section')}
          </p>
        </div>
        {targetBooks.length > 0 ? (
          <div className='grid gap-2 sm:grid-cols-[1fr_132px]'>
            <select
              className='select select-bordered select-sm min-w-0'
              value={targetBookHash}
              onChange={(event) => setTargetBookHash(event.target.value)}
              aria-label={_('Target book')}
            >
              {targetBooks.map((book) => (
                <option key={book.hash} value={book.hash}>
                  {book.title}
                </option>
              ))}
            </select>
            <select
              className='select select-bordered select-sm min-w-0'
              value={linkRelation}
              onChange={(event) => setLinkRelation(event.target.value as CodexLinkRelation)}
              aria-label={_('Reference relation')}
            >
              {relationOptions.map((relation) => (
                <option key={relation} value={relation}>
                  {getRelationLabel(relation)}
                </option>
              ))}
            </select>
            <input
              className='input input-bordered input-sm min-w-0'
              value={targetPassageLabel}
              onChange={(event) => setTargetPassageLabel(event.target.value)}
              placeholder={_('Target passage')}
              aria-label={_('Target passage')}
            />
            <input
              className='input input-bordered input-sm min-w-0'
              value={linkNote}
              onChange={(event) => setLinkNote(event.target.value)}
              placeholder={_('Note')}
              aria-label={_('Reference note')}
            />
            <div className='sm:col-span-2'>
              <TextButton onClick={handleAddLink} disabled={!targetBookHash}>
                <span className='inline-flex items-center gap-1'>
                  <Link2 className='h-3.5 w-3.5' aria-hidden='true' />
                  {_('Add Reference')}
                </span>
              </TextButton>
            </div>
          </div>
        ) : (
          <p className='text-base-content/60 text-xs'>
            {_('Add another book to create cross-book references.')}
          </p>
        )}
        {sectionLinks.length > 0 && (
          <div className='flex flex-col gap-2'>
            {sectionLinks.map((link) => (
              <div
                key={link.id}
                className='border-base-300 bg-base-100 flex items-start gap-2 rounded-md border px-2 py-1.5'
              >
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-xs font-medium'>
                    {getRelationLabel(link.relation)}
                    {' to '}
                    {link.target.bookTitle ?? link.target.bookHash}
                  </p>
                  {(link.target.passageLabel || link.note) && (
                    <p className='text-base-content/60 line-clamp-2 text-xs'>
                      {[link.target.passageLabel, link.note].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  type='button'
                  className='btn btn-ghost h-6 min-h-6 w-6 p-0'
                  onClick={() => handleDeleteLink(link.id)}
                  aria-label={_('Remove reference')}
                >
                  <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className='flex items-center justify-between gap-3' dir='ltr'>
        <div className='text-base-content/70 min-w-0 flex-1 truncate text-xs'>{message}</div>
        <div className='flex items-center gap-3'>
          <TextButton onClick={handleApplyToView} disabled={!draftHtml.trim()}>
            <span className='inline-flex items-center gap-1'>
              <Wand2 className='h-3.5 w-3.5' aria-hidden='true' />
              {_('Apply')}
            </span>
          </TextButton>
          <TextButton onClick={handleSaveDraft} disabled={!draftHtml.trim()}>
            <span className='inline-flex items-center gap-1'>
              <Save className='h-3.5 w-3.5' aria-hidden='true' />
              {_('Save')}
            </span>
          </TextButton>
          <TextButton
            onClick={handlePushDraft}
            disabled={!draftHtml.trim() || !token || !syncStatus.canPushDrafts}
          >
            <span className='inline-flex items-center gap-1'>
              <Upload className='h-3.5 w-3.5' aria-hidden='true' />
              {_('Push')}
            </span>
          </TextButton>
          <TextButton onClick={handleExportEpub} disabled={!draftHtml.trim() || !bookData.file}>
            <span className='inline-flex items-center gap-1'>
              <Download className='h-3.5 w-3.5' aria-hidden='true' />
              {_('Export')}
            </span>
          </TextButton>
        </div>
      </div>
    </div>
  );
};

export default CodexEditor;
