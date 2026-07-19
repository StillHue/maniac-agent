import { NextRequest } from 'next/server';
import { exec } from 'child_process';
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

    console.log(`[Continue] resuming session ${session.uuid.slice(0, 12)}... in ${session.repo}`);
    const escaped = text.replace(/"/g, '\\"');
    const cmd = `agent --resume=${session.uuid} --trust --print -p "${escaped}"`;

    const result = await new Promise<string>((resolve) => {
      exec(cmd, { cwd: session.workspace, shell: 'cmd.exe', timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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
