import { NextRequest } from 'next/server';
import { execFile } from 'child_process';

const HOME = 'C:\\Users\\gabdr';

export async function POST(req: NextRequest) {
  try {
    const { uuid, text } = await req.json() as { uuid?: string; text?: string };
    if (!uuid || !text) {
      return Response.json({ error: 'Missing uuid or text' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Validate UUID format to prevent injection via --resume parameter
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      return Response.json({ error: 'Invalid uuid format' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[GoalKeep] ${uuid.slice(0, 12)}... ${text.slice(0, 100)}`);

    const result = await new Promise<string>((resolve) => {
      execFile('agent', [`--resume=${uuid}`, '--trust', '-p', text], { cwd: HOME, timeout: 180000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) resolve(stderr?.slice(0, 500) || err.message);
        else resolve(stdout?.trim() || '(sem resposta)');
      });
    });

    return Response.json({
      status: 'ok',
      result: result.slice(0, 4000),
    }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[GoalKeep] Error:', e.message);
    return Response.json({ status: 'error', message: e.message }, { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
