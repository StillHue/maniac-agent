import * as http from 'http';
import * as crypto from 'crypto';
const ESC = '\x1b';
import * as path from 'path';

try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') }); } catch (e) {
  // dotenv is optional — it's fine if not installed
  console.debug('[server] dotenv not available:', e);
}

import { runEngine } from './engine';
import { EngineMode } from '@maniac/types';
import { getUndeliveredMessages, markDelivered } from './proactive';
import { executeToolCall } from './tools';
import { TOOL_CATALOG } from './tool-catalog';
import { getImmortalityStatus, checkResume, immortalitySummary, cleanImmortalityState, loadCheckpoint, MANIAC_DIR } from './immortality';

// ─── Rate Limiter ───────────────────────────────────────────────────────────
// Simple in-memory sliding window rate limiter to prevent abuse of HTTP routes.

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000;  // 1 minute
const RATE_LIMIT_MAX_REQS = 60;        // max requests per window

function rateLimit(ip: string): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(ip, entry);
  }
  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQS) {
    const oldest = entry.timestamps[0];
    return { allowed: false, remaining: 0, resetMs: oldest + RATE_LIMIT_WINDOW_MS - now };
  }
  entry.timestamps.push(now);
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQS - entry.timestamps.length, resetMs: 0 };
}

// Periodic cleanup of stale entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    entry.timestamps = entry.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (entry.timestamps.length === 0) rateLimitMap.delete(ip);
  }
}, 300_000).unref();

const PORT = parseInt(process.env.MANIAC_PORT || process.env.ARES_PORT || '3130', 10);
/** Default loopback only — set MANIAC_BIND=0.0.0.0 to expose on all interfaces. */
const BIND_HOST = process.env.MANIAC_BIND || '127.0.0.1';
const PID_FILE = path.join(__dirname, '..', '..', '..', '.maniac.pid');
const API_TOKEN = process.env.MANIAC_API_TOKEN || '';
/** Comma-separated allowed CORS origins. Default: localhost / 127.0.0.1 only. */
const CORS_ALLOW = (process.env.MANIAC_CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DANGEROUS_PATHS = new Set(['/api/engine/execute', '/api/engine/spawn']);

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function requireAuth(req: http.IncomingMessage): boolean {
  if (!API_TOKEN) return false;
  const provided = (req.headers['authorization'] as string) || '';
  const bearer = provided.startsWith('Bearer ') ? provided.slice(7) : provided;
  return timingSafeEqualStr(bearer, API_TOKEN);
}

function resolveCorsOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (CORS_ALLOW.length > 0) {
    return CORS_ALLOW.includes(origin) ? origin : null;
  }
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
      return origin;
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface ServerState {
  running: boolean;
  port: number;
  pid: number;
  startedAt: number;
  requestsServed: number;
  lastError: string | null;
}

let state: ServerState = {
  running: false,
  port: PORT,
  pid: process.pid,
  startedAt: 0,
  requestsServed: 0,
  lastError: null,
};

function writePid(): void {
  try {
    const fs = require('fs');
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (e) {
    console.debug('[server] Erro ao escrever PID:', e);
  }
}

function removePid(): void {
  try {
    const fs = require('fs');
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch (e) {
    console.debug('[server] Erro ao remover PID:', e);
  }
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON: ' + (e instanceof Error ? e.message : String(e)))); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any, origin?: string): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody(req);
    const message = body.message;
    const mode: EngineMode = body.mode || 'chat';
    const history = body.history || [];
    const stream = body.stream === true;

    if (!message) {
      sendJson(res, 400, { error: 'message required' });
      return;
    }

    if (!stream) {
      const isTerminal = req.headers['user-agent']?.includes('Terminal') || req.headers['accept'] === 'text/plain';
      let fullReply = '';
      await runEngine({
        message, mode, history,
        onEvent: (event) => {
          if (event.type === 'token') fullReply += event.content;
        },
      });
      state.requestsServed++;
      if (isTerminal) {
        const paginated = paginateText(fullReply, 40);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(paginated);
      } else {
        sendJson(res, 200, { response: fullReply, mode });
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendEvent = (event: string, data: string) => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    };

    await runEngine({
      message, mode, history,
      onEvent: (event) => {
        switch (event.type) {
          case 'token':
            sendEvent('token', JSON.stringify({ content: event.content }));
            break;
          case 'tool_start':
            sendEvent('tool_start', JSON.stringify({ tool: event.tool, args: event.args }));
            break;
          case 'tool_result':
            sendEvent('tool_result', JSON.stringify({ tool: event.tool, success: event.success, output: event.output }));
            break;
          case 'subagent_start':
            sendEvent('subagent_start', JSON.stringify({ id: event.id, goal: event.goal }));
            break;
          case 'subagents_dispatch':
            sendEvent('subagents_dispatch', JSON.stringify({ count: event.count }));
            break;
          case 'subagent_token':
            sendEvent('subagent_token', JSON.stringify({ id: event.id, content: event.content }));
            break;
          case 'subagent_tool':
            sendEvent('subagent_tool', JSON.stringify({
              id: event.id, tool: event.tool, done: event.done, success: event.success,
            }));
            break;
          case 'subagent_done':
            sendEvent('subagent_done', JSON.stringify({
              id: event.id, success: event.success, summary: event.summary,
            }));
            break;
          case 'mode':
            sendEvent('mode', JSON.stringify({ mode: event.mode }));
            break;
          case 'error':
            sendEvent('error', JSON.stringify({ message: event.message }));
            break;
          case 'done':
            sendEvent('done', JSON.stringify({}));
            break;
        }
      },
    });

    state.requestsServed++;
    res.end();
  } catch (e: any) {
    state.lastError = e.message;
    if (!res.headersSent) {
      sendJson(res, 500, { error: e.message });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
      res.end();
    }
  }
}

async function handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, {
    status: 'ok',
    pid: process.pid,
    uptime: Date.now() - state.startedAt,
    requestsServed: state.requestsServed,
    lastError: state.lastError,
  });
}

async function handleProactive(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const undelivered = getUndeliveredMessages();
  const ids = req.method === 'POST' ? req.url?.includes('mark') : false;
  if (ids) {
    try {
      const body = await parseBody(req);
      if (body.ids) markDelivered(body.ids);
    } catch (e) {
      console.debug('[server] Erro ao marcar entregas:', e);
    }
  }
  sendJson(res, 200, { messages: undelivered });
}

async function handleSpawn(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody(req);
    const command = body.command || 'node';
    const args = body.args || [];
    const cwd = body.cwd || process.cwd();

    const { spawn } = require('child_process');
    const child = spawn(command, args, {
      cwd,
      shell: 'cmd.exe',
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    sendJson(res, 200, { pid: child.pid, command, args, cwd, message: 'Processo lancado em novo terminal' });
  } catch (e: any) {
    sendJson(res, 500, { error: e.message });
  }
}

async function handleToolExecute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody(req);
    const type = body.type;
    const command = body.command || '';
    const cwd = body.cwd || process.cwd();

    if (!type) {
      sendJson(res, 400, { success: false, output: 'type is required' });
      return;
    }

    const result = await executeToolCall(type, command, cwd);
    sendJson(res, 200, result);
  } catch (e: any) {
    sendJson(res, 500, { success: false, output: e.message });
  }
}

async function handleImmortality(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const u = new URL(req.url || `/`, `http://${req.headers.host || 'localhost'}`);
    const action = u.searchParams.get('action');

    if (action === 'status') {
      const status = getImmortalityStatus();
      const resume = checkResume();
      sendJson(res, 200, {
        ...status,
        heartbeatAgeMs: status.heartbeatAge,
        checkpointAgeMs: status.checkpointAge,
        canResume: resume.shouldResume,
        crashReport: resume.crashReport,
        maniacDir: MANIAC_DIR,
      });
      return;
    }

    if (action === 'resume') {
      // Inspect-only — do not execute agent runs from this unauthenticated endpoint.
      // Actual resume: CLI startup tryAutoResume, or POST action=execute_resume with token.
      const resume = checkResume();
      if (resume.shouldResume && resume.checkpoint) {
        sendJson(res, 200, {
          canResume: true,
          soft: resume.checkpoint.version < 2 || !resume.checkpoint.toolBatch,
          checkpoint: {
            version: resume.checkpoint.version,
            timestamp: resume.checkpoint.timestamp,
            mode: resume.checkpoint.session.mode,
            messageCount: resume.checkpoint.session.messages.length,
            lastUserMessage: resume.checkpoint.session.lastUserMessage?.slice(0, 500),
            pendingTools: resume.checkpoint.toolBatch?.calls?.filter((c) => c.status === 'pending').length ?? null,
          },
          crashReport: resume.crashReport,
          hint: 'Use CLI auto-resume, maniac without --no-auto-resume, or action=execute_resume with MANIAC_RESUME_TOKEN',
        });
      } else {
        sendJson(res, 200, { canResume: false });
      }
      return;
    }

    if (action === 'execute_resume') {
      const token = process.env.MANIAC_RESUME_TOKEN || '';
      const provided =
        (req.headers['x-maniac-resume-token'] as string) ||
        new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).searchParams.get('token') ||
        '';
      if (!token || provided !== token) {
        sendJson(res, 401, { error: 'MANIAC_RESUME_TOKEN required (header X-Maniac-Resume-Token)' });
        return;
      }
      const { tryAutoResume } = require('./resume');
      const outcome = await tryAutoResume({ enabled: true });
      if (!outcome) {
        sendJson(res, 200, { canResume: false, message: 'No checkpoint to resume' });
        return;
      }
      sendJson(res, 200, {
        canResume: outcome.resumed,
        soft: outcome.soft,
        message: outcome.message,
        reply: outcome.reply?.slice(0, 4000),
      });
      return;
    }

    if (action === 'forget') {
      cleanImmortalityState();
      sendJson(res, 200, { success: true, message: 'Immortality state cleaned' });
      return;
    }

    if (action === 'summary') {
      sendJson(res, 200, { summary: immortalitySummary() });
      return;
    }

    // Default: full status
    const status = getImmortalityStatus();
    sendJson(res, 200, status);
  } catch (e: any) {
    sendJson(res, 500, { error: e.message });
  }
}

async function handleToolCatalog(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, TOOL_CATALOG.map(t => ({
    name: t.name,
    description: t.description,
    danger: t.danger || false,
    params: t.params,
  })));
}

const router: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>> = {
  '/api/engine/chat': handleChat,
  '/api/engine/health': handleHealth,
  '/api/engine/spawn': handleSpawn,
  '/api/engine/proactive': handleProactive,
  '/api/engine/execute': handleToolExecute,
  '/api/engine/immortality': handleImmortality,
  '/api/engine/tools': handleToolCatalog,
};

const server = http.createServer(async (req, res) => {
  const origin = resolveCorsOrigin(req.headers['origin']);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const isHealth = url.pathname === '/api/engine/health';
  const isDangerous = DANGEROUS_PATHS.has(url.pathname);

  // Dangerous endpoints always require a configured bearer token.
  if (isDangerous) {
    if (!API_TOKEN) {
      sendJson(res, 503, {
        error: 'MANIAC_API_TOKEN is required for /execute and /spawn',
      });
      return;
    }
    if (!requireAuth(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
  } else if (API_TOKEN && !isHealth && !requireAuth(req)) {
    // When a token is set, all non-health routes require it.
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Rate limiting by IP
  const ip = req.socket.remoteAddress || 'unknown';
  const rl = rateLimit(ip);
  if (!rl.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) });
    res.end(JSON.stringify({ error: 'rate limit exceeded', retryAfterMs: rl.resetMs }));
    return;
  }

  const handler = router[url.pathname];

  if (!handler) {
    sendJson(res, 404, { error: 'not found', paths: Object.keys(router) });
    return;
  }

  if (req.method === 'GET' && isHealth) {
    await handleHealth(req, res);
    return;
  }

  const allowGet =
    url.pathname === '/api/engine/immortality' ||
    url.pathname === '/api/engine/tools' ||
    url.pathname === '/api/engine/proactive';
  if (req.method === 'GET' && !allowGet) {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  await handler(req, res);
});

export function startServer(port?: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const p = port || PORT;
    state.running = true;
    state.startedAt = Date.now();
    state.pid = process.pid;

    server.listen(p, BIND_HOST, () => {
      writePid();
      console.log(`[maniac-server] PID ${process.pid} ouvindo em http://${BIND_HOST}:${p}`);
      // Safe auto-resume on startup (read-only pending tools only)
      if (process.env.MANIAC_NO_AUTO_RESUME !== '1') {
        try {
          const { tryAutoResume } = require('./resume');
          void tryAutoResume({ enabled: true }).then((outcome: any) => {
            if (outcome?.resumed) {
              console.log(`[maniac-server] auto-resume: ${outcome.message}`);
            }
          });
        } catch (e) {
          console.debug('[server] auto-resume falhou:', e);
        }
      }
      resolve(server);
    });

    server.on('error', (err: Error) => {
      state.running = false;
      state.lastError = err.message;
      reject(err);
    });
  });
}

export function stopServer(): void {
  removePid();
  state.running = false;
  server.close();
}

export function getServerState(): ServerState {
  return { ...state };
}

function paginateText(text: string, linesPerPage: number = 40): string {
  const lines = text.split('\n');
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage).join('\n'));
  }
  return pages.join('\n' + ESC + '[7m---PAGE---' + ESC + '[0m\n');
}

export { PORT, PID_FILE };

// Auto-start when run as standalone script
if (process.argv[1]?.endsWith('server.js')) {
  startServer().catch(err => {
    console.error('[maniac-server] falha ao iniciar:', err.message);
    process.exit(1);
  });
}
