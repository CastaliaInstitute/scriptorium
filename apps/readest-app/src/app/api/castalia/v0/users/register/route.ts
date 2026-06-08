import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { castaliaServerStore } from '@/services/castalia/serverStore';

export async function POST(request: Request) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const profile = await castaliaServerStore.registerUser(
    user,
    typeof body === 'object' && body !== null ? body : undefined,
  );
  return NextResponse.json({ profile });
}
