import { NextRequest } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { saveSession } from '../../../lib/session';

const SESSION_DIR = 'C:\\Users\\gabdr\\agent-session';
const LAST_RESULT = SESSION_DIR + '\\last-result.md';

const HOME = 'C:\\Users\\gabdr';
const DESKTOP = path.join(HOME, 'Desktop');

function findRepo(name: string): string | null {
  const q = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const scanDirs = [HOME, DESKTOP, path.join(HOME, 'Documents')];
  const seen = new Set<string>();
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const lower = entry.toLowerCase();
        const lowerClean = lower.replace(/[^a-z0-9]/g, '');
        if (lower.includes(q) || q.includes(lower) || lowerClean.includes(q) || q.includes(lowerClean)) {
          if (seen.has(lower)) continue;
          seen.add(lower);
          const full = path.join(dir, entry);
          try {
            if (fs.statSync(full).isDirectory()) return full;
          } catch {}
        }
      }
    } catch {}
  }
  return null;
}

function findLatestSession(): string | null {
  const chatsDir = path.join(os.homedir(), '.cursor', 'chats');
  let latest: string | null = null;
  let latestTs = 0;
  try {
    const workspaces = fs.readdirSync(chatsDir);
    for (const ws of workspaces) {
      const wsDir = path.join(chatsDir, ws);
      if (!fs.statSync(wsDir).isDirectory()) continue;
      const sessions = fs.readdirSync(wsDir);
      for (const sid of sessions) {
        const metaPath = path.join(wsDir, sid, 'meta.json');
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          const ts = meta.updatedAtMs || meta.createdAtMs || 0;
          if (ts > latestTs) {
            latestTs = ts;
            latest = sid;
          }
        } catch {}
      }
    }
  } catch {}
  return latest;
}

function parseGoal(input: string): { repoName: string | null; task: string } {
  const colonIdx = input.indexOf(':');
  if (colonIdx > 0) {
    return { repoName: input.slice(0, colonIdx).trim(), task: input.slice(colonIdx + 1).trim() };
  }
  return { repoName: null, task: input };
}

function waitForNewSession(before: string | null, timeoutMs = 60000): Promise<string | null> {
  return new Promise((resolve) => {
    let tries = 0;
    const iv = setInterval(() => {
      const u = findLatestSession();
      if (u && u !== before) { clearInterval(iv); resolve(u); }
      tries++;
      if (tries >= timeoutMs / 500) { clearInterval(iv); resolve(null); }
    }, 500);
  });
}

function waitForFile(filePath: string, timeoutMs = 300000): Promise<boolean> {
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      if (fs.existsSync(filePath)) { clearInterval(iv); resolve(true); }
    }, 1000);
    setTimeout(() => { clearInterval(iv); resolve(false); }, timeoutMs);
  });
}

export async function POST(req: NextRequest) {
  try {
    const { goal } = await req.json() as { goal?: string };
    if (!goal) {
      return Response.json({ error: 'Missing goal' }, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[Goal] Received: ${goal}`);
    const { repoName, task } = parseGoal(goal);
    const repoPath = repoName ? findRepo(repoName) : null;

    if (repoName && !repoPath) {
      let all: string[] = [];
      try {
        all = fs.readdirSync(HOME).filter(f => {
          try { return fs.statSync(path.join(HOME, f)).isDirectory() && fs.existsSync(path.join(HOME, f, '.git')); } catch { return false; }
        });
      } catch {}
      return Response.json({
        status: 'not_found',
        message: `Repo "${repoName}" not found. Available: ${all.join(', ')}`,
        repos: all,
      }, { headers: { 'Content-Type': 'application/json' } });
    }

    // Clean up old session files
    try { if (fs.existsSync(LAST_RESULT)) fs.unlinkSync(LAST_RESULT); } catch {}
    const nextInstr = SESSION_DIR + '\\next-instruction.md';
    try { if (fs.existsSync(nextInstr)) fs.unlinkSync(nextInstr); } catch {}

    const targetDir = repoPath || HOME;
    const fullPrompt = task;
    const repo = path.basename(targetDir);
    const escaped = fullPrompt.replace(/"/g, '\\"');
    const beforeSession = findLatestSession();

    // Run agent in non-interactive mode (--print -y), capture output
    const agentCmd = `agent --print -y "${escaped}"`;
    const agentPromise = new Promise<string>((resolve) => {
      exec(agentCmd, { cwd: targetDir, shell: 'cmd.exe', timeout: 600000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const output = (stdout?.trim() || stderr?.trim() || err?.message || '').slice(0, 16000);
        console.log(`[Goal] Agent process done (${output.length} chars)`);
        resolve(output);
      });
    });

    // Poll for session UUID concurrently
    const uuid = await waitForNewSession(beforeSession);
    console.log(`[Goal] Session ${uuid || 'none'} for ${repo}`);

    if (uuid) {
      saveSession({ uuid, repo, workspace: targetDir, createdAt: new Date().toISOString() });
      console.log(`[Goal] Active session saved: ${uuid}`);
    }

    // Wait for agent process and last-result.md
    const [agentOutput] = await Promise.all([
      agentPromise,
      waitForFile(LAST_RESULT, 600000),
    ]);

    let lastResult = '';
    try { if (fs.existsSync(LAST_RESULT)) lastResult = fs.readFileSync(LAST_RESULT, 'utf8').trim(); } catch {}

    return Response.json({
      status: uuid ? 'ok' : 'no_session',
      session: uuid,
      message: uuid
        ? `🎯 Agente rodando em ${repo}. Envie mensagens que serão enviadas automaticamente pra ele.`
        : `Agent iniciado em ${repo} mas session UUID nao encontrado`,
      repo: targetDir,
      lastResult: lastResult.slice(0, 32000),
      agentOutput: agentOutput.slice(0, 8000),
    }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[Goal] Error:', e.message);
    return Response.json({ status: 'error', message: e.message }, { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
