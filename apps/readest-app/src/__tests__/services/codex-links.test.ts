import { beforeEach, describe, expect, test, vi } from 'vitest';
import { codexLinkStore, getCodexPassageKey } from '@/services/castalia/codexLinks';

beforeEach(() => {
  localStorage.clear();
});

describe('codexLinkStore', () => {
  test('builds stable passage keys', () => {
    expect(
      getCodexPassageKey({
        bookHash: 'book-1',
        sectionIndex: 2,
        sectionHref: 'chapter-2.xhtml',
        passageLabel: 'p3',
      }),
    ).toBe('book-1:2:chapter-2.xhtml:p3');
  });

  test('saves and lists source links', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('link-1');
    const source = {
      bookHash: 'book-1',
      bookTitle: 'Source',
      sectionIndex: 1,
      sectionLabel: 'Chapter 1',
    };
    const target = {
      bookHash: 'book-2',
      bookTitle: 'Target',
      passageLabel: 'Chapter 7',
    };

    const link = codexLinkStore.saveLink({
      relation: 'echoes',
      source,
      target,
      note: 'Shared image',
    });

    expect(link).toMatchObject({
      id: 'link-1',
      relation: 'echoes',
      source,
      target,
      note: 'Shared image',
    });
    expect(codexLinkStore.listSourceLinks(source)).toEqual([link]);
    expect(codexLinkStore.listBookLinks('book-2')).toEqual([link]);
    expect(codexLinkStore.listCrossPointLinks('book-1')).toEqual([
      {
        id: 'link-1',
        rel: 'echoes',
        title: 'Shared image',
        source: {
          bookHash: 'book-1',
          label: 'Chapter 1',
        },
        target: {
          bookHash: 'book-2',
          label: 'Chapter 7',
        },
        createdAt: new Date(link.createdAt).toISOString(),
        updatedAt: new Date(link.updatedAt).toISOString(),
      },
    ]);
  });

  test('deletes links', () => {
    const link = codexLinkStore.saveLink({
      relation: 'references',
      source: { bookHash: 'book-1', sectionIndex: 0 },
      target: { bookHash: 'book-2' },
    });

    codexLinkStore.deleteLink(link.id);

    expect(codexLinkStore.listLinks()).toEqual([]);
  });
});
