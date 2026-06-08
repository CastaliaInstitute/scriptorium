import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateUserAndToken } from '@/utils/access';
import { castaliaServerStore } from '@/services/castalia/serverStore';

const repositorySchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(240),
  url: z.string().max(2048).optional(),
  branch: z.string().max(240).optional(),
  provider: z.enum(['castalia', 'git', 'local']).optional(),
  role: z.enum(['owner', 'editor', 'reader']).optional(),
});

export async function GET(request: Request) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return NextResponse.json({
    repositories: await castaliaServerStore.listRepositories(user),
  });
}

export async function PUT(request: Request) {
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

  const parsed = repositorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid repository' }, { status: 400 });
  }

  return NextResponse.json({
    repository: await castaliaServerStore.saveRepository(user, parsed.data),
  });
}
