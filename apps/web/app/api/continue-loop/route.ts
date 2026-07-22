import { NextRequest } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import { getSession } from '../../../lib/session';

const SESSION_DIR = 'C:\\Users\\gabdr\\agent-session';
const NEXT_INSTR = SESSION_DIR + '\\next-instruction.md';
const LAST_RESULT = SESSION_DIR + '\\last-result.md';

export async function POST(req: NextRequest) {
  try {
    const session = getSession();
    if (!session) {
      return Response.json({ status: 'no_session', message: 'Nenhuma sessao ativa.' }, { headers: { 'Content-Type': 'application/json' } });
    }

    if (!fs.existsSync(NEXT_INSTR)) {
      return Response.json({ status: 'no_instruction', message: 'Nenhuma next-instruction.md encontrada.' }, { headers: { 'Content-Type': 'application/json' } });
    }

    const instruction = fs.readFileSync(NEXT_INSTR, 'utf8').trim();
    console.log(`[ContinueLoop] Running for ${session.repo}: ${instruction.slice(0, 120)}`);

    const promptText = 'Read C:\\Users\\gabdr\\agent-session\\next-instruction.md and execute the instruction. After completing, save a detailed summary to C:\\Users\\gabdr\\agent-session\\last-result.md';

    const result = await new Promise<string>((resolve) => {
      execFile('agent', ['-p', promptText, '-y', '--print'], { cwd: session.workspace, timeout: 600000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').slice(0, 4000);
          resolve(msg || 'Erro desconhecido');
        } else {
          resolve(stdout?.trim() || '(sem saida)');
        }
      });
    });

    console.log(`[ContinueLoop] Done (${result.length} chars)`);

    let lastResult = '';
    try {
      if (fs.existsSync(LAST_RESULT)) {
        lastResult = fs.readFileSync(LAST_RESULT, 'utf8').trim();
      }
    } catch {}

    try {
      if (fs.existsSync(NEXT_INSTR)) fs.unlinkSync(NEXT_INSTR);
    } catch {}

    return Response.json({
      status: 'ok',
      result: result.slice(0, 16000),
      lastResult: lastResult.slice(0, 16000),
      hasMore: result.length > 16000 || lastResult.length > 16000,
    }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[ContinueLoop] Error:', e.message);
    return Response.json({ status: 'error', message: e.message }, { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
