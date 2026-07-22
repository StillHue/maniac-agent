import { NextRequest } from 'next/server';
import { execFile } from 'child_process';

const HOME = 'C:\\Users\\gabdr';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text?: string };
    if (!text) {
      return Response.json({ error: 'Missing text' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[Task] Received: ${text.slice(0, 100)}`);

    const result = await new Promise<string>((resolve) => {
      execFile('agent', ['--trust', '-p', text], { cwd: HOME, timeout: 180000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) resolve(stderr?.slice(0, 500) || err.message);
        else resolve(stdout?.trim() || '(sem resposta)');
      });
    });

    return Response.json({
      status: 'ok',
      result: result.slice(0, 4000),
    }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[Task] Error:', e.message);
    return Response.json({ status: 'error', message: e.message }, { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
