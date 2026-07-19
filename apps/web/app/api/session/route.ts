import { NextRequest } from 'next/server';
import { getSession, saveSession, clearSession } from '../../../lib/session';

export async function GET() {
  const session = getSession();
  if (!session) {
    return Response.json({ active: false }, { headers: { 'Content-Type': 'application/json' } });
  }
  return Response.json({ active: true, ...session }, { headers: { 'Content-Type': 'application/json' } });
}

export async function POST(req: NextRequest) {
  try {
    const { uuid, repo, workspace } = await req.json() as { uuid: string; repo: string; workspace: string };
    if (!uuid) {
      return Response.json({ error: 'Missing uuid' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    saveSession({ uuid, repo, workspace, createdAt: new Date().toISOString() });
    return Response.json({ status: 'ok', message: 'Session set' }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function DELETE() {
  clearSession();
  return Response.json({ status: 'ok', message: 'Session cleared' }, { headers: { 'Content-Type': 'application/json' } });
}
