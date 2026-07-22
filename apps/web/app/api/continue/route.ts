import { NextRequest } from 'next/server';
import { execFile } from 'child_process';
import { getSession } from '../../../lib/session';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text?: string };
    if (!text) {
      return Response.json({ error: 'Missing text' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const session = getSession();
    if (!session) {
      return Response.json({ status: 'no_session', message: 'Nenhuma sessao ativa. Use /goal primeiro.' }, { headers: { 'Content-Type': 'application/json' } });
    }

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.uuid)) {
      return Response.json({ error: 'Invalid session uuid' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[Continue] resuming session ${session.uuid.slice(0, 12)}... in ${session.repo}`);

    const result = await new Promise<string>((resolve) => {
      execFile('agent', [`--resume=${session.uuid}`, '--trust', '--print', '-p', text], { cwd: session.workspace, timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) resolve(stderr?.slice(0, 4000) || err.message);
        else resolve(stdout?.trim() || '(sem resposta)');
      });
    });

    console.log(`[Continue] Done (${result.length} chars)`);
    return Response.json({ status: 'ok', result: result.slice(0, 8000) }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[Continue] Error:', e.message);
    return Response.json({ status: 'error', message: e.message }, { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
