import * as http from 'http';
const ESC = '\x1b';
import * as path from 'path';

try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') }); } catch {} // skip if dotenv not installed

import { runEngine } from './engine';
import { EngineMode } from '@maniac/types';
import { getUndeliveredMessages, markDelivered } from './proactive';
import { executeToolCall } from './tools';
import { TOOL_CATALOG } from './tool-catalog';
import { getImmortalityStatus, checkResume, immortalitySummary, cleanImmortalityState, loadCheckpoint, MANIAC_DIR } from './immortality';

const PORT = parseInt(process.env.MANIAC_PORT || process.env.ARES_PORT || '3130', 10);
const PID_FILE = path.join(__dirname, '..', '..', '..', '.maniac.pid');

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
  } catch {}
}

function removePid(): void {
  try {
    const fs = require('fs');
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {}
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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
      'Access-Control-Allow-Origin': '*',
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
    } catch {}
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
      const resume = checkResume();
      if (resume.shouldResume && resume.checkpoint) {
        sendJson(res, 200, {
          canResume: true,
          checkpoint: {
            timestamp: resume.checkpoint.timestamp,
            mode: resume.checkpoint.session.mode,
            messageCount: resume.checkpoint.session.messages.length,
            lastUserMessage: resume.checkpoint.session.lastUserMessage,
            lastAssistantReply: resume.checkpoint.session.lastAssistantReply,
          },
          crashReport: resume.crashReport,
        });
      } else {
        sendJson(res, 200, { canResume: false });
      }
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
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const handler = router[url.pathname];

  if (!handler) {
    sendJson(res, 404, { error: 'not found', paths: Object.keys(router) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/engine/health') {
    await handleHealth(req, res);
    return;
  }

  if (req.method !== 'POST') {
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

    server.listen(p, () => {
      writePid();
      console.log(`[maniac-server] PID ${process.pid} ouvindo em http://localhost:${p}`);
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
