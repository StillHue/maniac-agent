import { NextRequest } from 'next/server';
import { exec } from 'child_process';

const HOME = 'C:\\Users\\gabdr';

export async function POST(req: NextRequest) {
  try {
    const { uuid, text } = await req.json() as { uuid?: string; text?: string };
    if (!uuid || !text) {
      return Response.json({ error: 'Missing uuid or text' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[GoalKeep] ${uuid.slice(0, 12)}... ${text.slice(0, 100)}`);
    const escaped = text.replace(/"/g, '\\"');
    const cmd = `agent --resume=${uuid} --trust -p "${escaped}"`;

    const result = await new Promise<string>((resolve) => {
      exec(cmd, { cwd: HOME, shell: 'cmd.exe', timeout: 180000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
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
