import React, { useEffect, useMemo, useState } from 'react';
import { Download, Save, Upload, Wand2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { castaliaClient } from '@/services/castalia/client';
import { CodexDraft, codexDraftStore } from '@/services/castalia/codexDrafts';
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
  const activeRepository = castaliaClient.getActiveRepository();
  const syncStatus = castaliaClient.getRepositorySyncStatus(activeRepository);

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
