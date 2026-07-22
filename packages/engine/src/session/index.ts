import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { ChatMessage, StreamEvent } from '@maniac/types';

const SESSIONS_ROOT = path.join(os.homedir(), '.maniac', 'sessions');

export interface SessionSummary {
  id: string;
  cwd: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  numMessages: number;
  parentSessionId?: string;
}

export interface SessionRecord {
  summary: SessionSummary;
  messages: ChatMessage[];
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function encodeCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  const hash = crypto.createHash('sha256').update(resolved.toLowerCase()).digest('hex').slice(0, 12);
  const slug = path.basename(resolved).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'cwd';
  return `${slug}-${hash}`;
}

export function sessionDir(cwd: string, sessionId: string): string {
  const safeId = sanitizeSessionId(sessionId);
  return path.join(SESSIONS_ROOT, encodeCwd(cwd), safeId);
}

/** Reject path traversal / absolute segments in session ids. */
export function sanitizeSessionId(sessionId: string): string {
  const id = String(sessionId || '').trim();
  if (!id || id.length > 64 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new Error(`invalid session id: ${sessionId}`);
  }
  return id;
}

export function createSessionId(): string {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(4).toString('hex');
  return `${t}-${r}`;
}

export function createSession(cwd: string, opts?: { title?: string; model?: string; parentSessionId?: string }): SessionSummary {
  const id = createSessionId();
  const now = Date.now();
  const summary: SessionSummary = {
    id,
    cwd: path.resolve(cwd),
    title: opts?.title || 'untitled',
    createdAt: now,
    updatedAt: now,
    model: opts?.model,
    numMessages: 0,
    parentSessionId: opts?.parentSessionId,
  };
  const dir = sessionDir(cwd, id);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(dir, 'chat_history.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'updates.jsonl'), '');
  return summary;
}

export function appendChatMessage(cwd: string, sessionId: string, message: ChatMessage): void {
  const dir = sessionDir(cwd, sessionId);
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, 'chat_history.jsonl'), JSON.stringify(message) + '\n');
  touchSummary(cwd, sessionId, { numMessagesDelta: 1 });
}

export function appendSessionUpdate(cwd: string, sessionId: string, event: StreamEvent | Record<string, unknown>): void {
  const dir = sessionDir(cwd, sessionId);
  ensureDir(dir);
  const line = JSON.stringify({ ts: Date.now(), ...event });
  fs.appendFileSync(path.join(dir, 'updates.jsonl'), line + '\n');
  touchSummary(cwd, sessionId);
}

function touchSummary(cwd: string, sessionId: string, opts?: { numMessagesDelta?: number; title?: string }): void {
  try {
    const p = path.join(sessionDir(cwd, sessionId), 'summary.json');
    const summary: SessionSummary = JSON.parse(fs.readFileSync(p, 'utf8'));
    summary.updatedAt = Date.now();
    if (opts?.numMessagesDelta) summary.numMessages += opts.numMessagesDelta;
    if (opts?.title) summary.title = opts.title;
    fs.writeFileSync(p, JSON.stringify(summary, null, 2));
  } catch (e) {
    console.debug('[session] touchSummary:', e);
  }
}

export function loadSessionMessages(cwd: string, sessionId: string): ChatMessage[] {
  try {
    const p = path.join(sessionDir(cwd, sessionId), 'chat_history.jsonl');
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ChatMessage;
        } catch {
          return null;
        }
      })
      .filter((m): m is ChatMessage => !!m);
  } catch {
    return [];
  }
}

export function loadSessionSummary(cwd: string, sessionId: string): SessionSummary | null {
  try {
    const p = path.join(sessionDir(cwd, sessionId), 'summary.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.debug('[session] loadSessionSummary:', e);
  }
  return null;
}

export function listSessions(cwd: string, limit = 20): SessionSummary[] {
  const group = path.join(SESSIONS_ROOT, encodeCwd(cwd));
  if (!fs.existsSync(group)) return [];
  const entries = fs.readdirSync(group);
  const summaries: SessionSummary[] = [];
  for (const id of entries) {
    // Skip anything that wouldn't pass sanitizeSessionId (e.g. planted `..` dirs)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) continue;
    const s = loadSessionSummary(cwd, id);
    if (s) summaries.push(s);
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function findLatestSession(cwd: string): SessionSummary | null {
  const list = listSessions(cwd, 1);
  return list[0] || null;
}

export function loadSession(cwd: string, sessionId: string): SessionRecord | null {
  const summary = loadSessionSummary(cwd, sessionId);
  if (!summary) return null;
  return { summary, messages: loadSessionMessages(cwd, sessionId) };
}
