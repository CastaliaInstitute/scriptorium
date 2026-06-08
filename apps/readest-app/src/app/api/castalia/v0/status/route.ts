import { NextResponse } from 'next/server';
import { listCastaliaRepositoryPluginManifests } from '@/services/castalia/repositoryProviders';

export async function GET() {
  return NextResponse.json({
    service: 'castalia-scriptorium',
    version: '0.1.0',
    endpoints: [
      '/v0/status',
      '/v0/users/register',
      '/v0/repositories',
      '/v0/repositories/:repositoryId/codex-drafts',
    ],
    repositoryPlugins: listCastaliaRepositoryPluginManifests(),
  });
}
