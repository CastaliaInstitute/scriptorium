import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateUserAndToken } from '@/utils/access';
import { castaliaServerStore } from '@/services/castalia/serverStore';

const codexDraftSchema = z.object({
  repositoryId: z.string().optional(),
  bookHash: z.string().min(1).max(160),
  sectionIndex: z.number().int().nonnegative(),
  sectionLabel: z.string().max(512).optional(),
  sectionHref: z.string().max(2048).optional(),
  html: z.string(),
  text: z.string(),
  syncStatus: z.enum(['local', 'pushed', 'error']).optional(),
  updatedAt: z.number(),
  pushedAt: z.number().optional(),
});

interface RouteContext {
  params: Promise<{
    repositoryId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { repositoryId } = await context.params;
  return NextResponse.json({
    drafts: await castaliaServerStore.listDrafts(user, repositoryId),
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawDraft = typeof body === 'object' && body !== null && 'draft' in body ? body.draft : body;
  const parsed = codexDraftSchema.safeParse(rawDraft);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Codex draft' }, { status: 400 });
  }

  const { repositoryId } = await context.params;
  return NextResponse.json({
    draft: await castaliaServerStore.saveDraft(user, repositoryId, parsed.data),
  });
}
