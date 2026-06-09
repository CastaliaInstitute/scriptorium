import React, { useState } from 'react';
import { BookOpen, PenLine } from 'lucide-react';
import Dialog from '@/components/Dialog';
import TextButton from '@/components/TextButton';
import { useTranslation } from '@/hooks/useTranslation';
import { createCodexEpubFile } from '@/services/castalia/epubCreate';

interface NewCodexDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (file: File) => Promise<void>;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const NewCodexDialog: React.FC<NewCodexDialogProps> = ({ isOpen, onClose, onCreate }) => {
  const _ = useTranslation();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [initialText, setInitialText] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isCreating) return;
    setIsCreating(true);
    try {
      const paragraphs = initialText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);
      const file = await createCodexEpubFile({
        title: trimmedTitle,
        author,
        bodyHtml:
          paragraphs.length > 0
            ? `<h1>${escapeHtml(trimmedTitle)}</h1>\n${paragraphs.join('\n')}`
            : undefined,
      });
      await onCreate(file);
      setTitle('');
      setAuthor('');
      setInitialText('');
      onClose();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog
      title={_('New Codex')}
      isOpen={isOpen}
      onClose={onClose}
      boxClassName='sm:h-[560px] sm:max-w-[560px]'
      contentClassName='flex flex-col gap-4'
    >
      <div className='flex items-center gap-3'>
        <div className='bg-base-300 flex h-10 w-10 shrink-0 items-center justify-center rounded-md'>
          <BookOpen className='h-5 w-5' aria-hidden='true' />
        </div>
        <div className='min-w-0'>
          <p className='text-base font-medium'>{_('Create an editable EPUB book')}</p>
          <p className='text-base-content/60 text-sm'>
            {_('The book is added to your library as a Castalia Codex.')}
          </p>
        </div>
      </div>

      <label className='flex flex-col gap-1'>
        <span className='text-sm'>{_('Title')}</span>
        <input
          className='input input-bordered bg-base-100 w-full'
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={_('Untitled Codex')}
          autoFocus
        />
      </label>

      <label className='flex flex-col gap-1'>
        <span className='text-sm'>{_('Author')}</span>
        <input
          className='input input-bordered bg-base-100 w-full'
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder={_('Castalia Institute')}
        />
      </label>

      <label className='flex min-h-0 flex-1 flex-col gap-1'>
        <span className='text-sm'>{_('Opening text')}</span>
        <textarea
          className='textarea textarea-bordered bg-base-100 min-h-[160px] flex-1 resize-none'
          value={initialText}
          onChange={(event) => setInitialText(event.target.value)}
          placeholder={_('Begin writing here...')}
        />
      </label>

      <div className='flex justify-end gap-3 pb-1'>
        <TextButton onClick={onClose}>{_('Cancel')}</TextButton>
        <TextButton onClick={handleCreate} disabled={!title.trim() || isCreating}>
          <span className='inline-flex items-center gap-1'>
            <PenLine className='h-3.5 w-3.5' aria-hidden='true' />
            {isCreating ? _('Creating...') : _('Create')}
          </span>
        </TextButton>
      </div>
    </Dialog>
  );
};

export default NewCodexDialog;
