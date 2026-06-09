import type { CrossBookLink, CrossBookLocation } from './crosspointCatalog';

const STORAGE_KEY = 'castalia:codex-links:v1';

export type CodexLinkRelation =
  | 'echoes'
  | 'supports'
  | 'contradicts'
  | 'references'
  | 'expands'
  | 'influenced_by';

export interface CodexPassageRef {
  bookHash: string;
  bookTitle?: string;
  sectionIndex?: number;
  sectionLabel?: string;
  sectionHref?: string;
  passageLabel?: string;
}

export interface CodexLink {
  id: string;
  relation: CodexLinkRelation;
  source: CodexPassageRef;
  target: CodexPassageRef;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

type LinkMap = Record<string, CodexLink>;

const createId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const getCodexPassageKey = (passage: CodexPassageRef) =>
  `${passage.bookHash}:${passage.sectionIndex ?? 'book'}:${passage.sectionHref ?? ''}:${
    passage.passageLabel ?? ''
  }`;

const readLinkMap = (): LinkMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LinkMap) : {};
  } catch {
    return {};
  }
};

const writeLinkMap = (links: LinkMap) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
};

const compareLinks = (a: CodexLink, b: CodexLink) => b.updatedAt - a.updatedAt;

const getCrossPointLinkLocation = (passage: CodexPassageRef): CrossBookLocation => {
  const label = passage.passageLabel ?? passage.sectionLabel;
  return {
    bookHash: passage.bookHash,
    ...(passage.sectionHref ? { href: passage.sectionHref } : {}),
    ...(label ? { label } : {}),
  };
};

export const toCrossPointLink = (link: CodexLink): CrossBookLink => ({
  id: link.id,
  rel: link.relation,
  ...(link.note ? { title: link.note } : {}),
  source: getCrossPointLinkLocation(link.source),
  target: getCrossPointLinkLocation(link.target),
  createdAt: new Date(link.createdAt).toISOString(),
  updatedAt: new Date(link.updatedAt).toISOString(),
});

export const codexLinkStore = {
  saveLink(link: Omit<CodexLink, 'id' | 'createdAt' | 'updatedAt'>): CodexLink {
    const links = readLinkMap();
    const now = Date.now();
    const nextLink: CodexLink = {
      ...link,
      id: createId(),
      note: link.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    links[nextLink.id] = nextLink;
    writeLinkMap(links);
    return nextLink;
  },

  deleteLink(id: string) {
    const links = readLinkMap();
    delete links[id];
    writeLinkMap(links);
  },

  listLinks(): CodexLink[] {
    return Object.values(readLinkMap()).sort(compareLinks);
  },

  listSourceLinks(source: CodexPassageRef): CodexLink[] {
    const sourceKey = getCodexPassageKey(source);
    return this.listLinks().filter((link) => getCodexPassageKey(link.source) === sourceKey);
  },

  listBookLinks(bookHash: string): CodexLink[] {
    return this.listLinks().filter(
      (link) => link.source.bookHash === bookHash || link.target.bookHash === bookHash,
    );
  },

  listCrossPointLinks(bookHash: string): CrossBookLink[] {
    return this.listBookLinks(bookHash).map(toCrossPointLink);
  },
};
