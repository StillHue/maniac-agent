import * as readline from 'readline';
import type { ToolOutput } from './tools';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export type AcpMethodHandler = (params: unknown) => unknown | Promise<unknown>;

export interface AcpServerOptions {
  /** Custom method handlers beyond the built-in ones */
  methods?: Record<string, AcpMethodHandler>;
  /** Logger for server-side messages */
  log?: (msg: string) => void;
}

// ─── Server State ──────────────────────────────────────────────────────────

let running = false;
let rlInterface: readline.Interface | null = null;
let customMethods: Record<string, AcpMethodHandler> = {};
let logger: (msg: string) => void = (msg) => {
  // Log as JSON on stderr so it doesn't pollute stdout
  process.stderr.write(`[acp] ${msg}\n`);
};

// ─── Response Helpers ─────────────────────────────────────────────────────

function sendResponse(id: string | number | null, result?: unknown, error?: JsonRpcError): void {
  const resp: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    result,
    error,
  };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

function methodNotImplemented(id: string | number | null, method: string): void {
  sendResponse(id, undefined, { code: -32601, message: `Method not found: ${method}` });
}

// ─── Built-in Methods ─────────────────────────────────────────────────────

function handleListTools(): unknown {
  const { TOOL_CATALOG } = require('./tool-catalog');
  return TOOL_CATALOG.map((t: any) => ({
    name: t.name,
    description: t.description,
    danger: t.danger,
    params: t.params || null,
  }));
}

async function handleCallTool(params: unknown): Promise<unknown> {
  const p = params as { tool: string; args: string; cwd?: string } | undefined;
  if (!p || !p.tool) {
    throw { code: -32602, message: 'Missing required parameter: tool' };
  }

  const { executeToolCall } = require('./tools');
  const cwd = p.cwd || process.cwd();
  const result: ToolOutput = await executeToolCall(p.tool, p.args || '', cwd);
  return {
    success: result.success,
    output: result.output,
  };
}

function handleGetStatus(): unknown {
  return {
    version: '1.0.0',
    name: 'maniac-acp',
    platform: process.platform,
    running: true,
    uptime: process.uptime(),
  };
}

// ─── Request Router ────────────────────────────────────────────────────────

async function handleRequest(body: string): Promise<void> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(body);
  } catch {
    sendResponse(null, undefined, { code: -32700, message: 'Parse error' });
    return;
  }

  if (req.jsonrpc !== '2.0') {
    sendResponse(req.id, undefined, { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' });
    return;
  }

  const method = req.method;

  // Check custom methods first
  if (customMethods[method]) {
    try {
      const result = await Promise.resolve(customMethods[method](req.params));
      sendResponse(req.id, result);
    } catch (e: any) {
      sendResponse(req.id, undefined, {
        code: e.code || -32000,
        message: e.message || 'Internal error',
        data: e.data,
      });
    }
    return;
  }

  switch (method) {
    case 'list_tools':
      sendResponse(req.id, handleListTools());
      break;
    case 'call_tool':
      try {
        const result = await handleCallTool(req.params);
        sendResponse(req.id, result);
      } catch (e: any) {
        sendResponse(req.id, undefined, {
          code: e.code || -32000,
          message: e.message || 'Internal error',
        });
      }
      break;
    case 'get_status':
      sendResponse(req.id, handleGetStatus());
      break;
    case 'ping':
      sendResponse(req.id, 'pong');
      break;
    case 'shutdown':
      sendResponse(req.id, 'shutting down');
      stopAcpServer();
      break;
    default:
      methodNotImplemented(req.id, method);
  }
}

// ─── Server Control ────────────────────────────────────────────────────────

/**
 * Start the ACP server (listens on stdin for JSON-RPC 2.0 lines).
 */
export function startAcpServer(options?: AcpServerOptions): { success: boolean; output: string } {
  if (running) {
    return { success: false, output: 'ACP server is already running.' };
  }

  if (options?.methods) {
    customMethods = { ...customMethods, ...options.methods };
  }
  if (options?.log) {
    logger = options.log;
  }

  running = true;
  rlInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rlInterface.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    handleRequest(trimmed).catch((err) => {
      logger(`Unhandled error: ${err.message}`);
    });
  });

  rlInterface.on('close', () => {
    running = false;
    rlInterface = null;
    logger('stdin closed, ACP server stopped.');
  });

  process.stderr.write('[acp] ACP server started, listening on stdin...\n');

  return { success: true, output: 'ACP server started (listening on stdin for JSON-RPC 2.0).' };
}

/**
 * Stop the ACP server.
 */
export function stopAcpServer(): { success: boolean; output: string } {
  if (!running) {
    return { success: false, output: 'ACP server is not running.' };
  }

  running = false;
  if (rlInterface) {
    rlInterface.close();
    rlInterface = null;
  }

  process.stderr.write('[acp] ACP server stopped.\n');
  return { success: true, output: 'ACP server stopped.' };
}

/**
 * Check if the ACP server is running.
 */
export function isAcpRunning(): boolean {
  return running;
}

/**
 * Get ACP server status.
 */
export function getAcpStatus(): { success: boolean; output: string } {
  if (!running) {
    return { success: false, output: 'ACP server is not running.' };
  }
  return {
    success: true,
    output: `ACP server running | uptime: ${Math.floor(process.uptime())}s | platform: ${process.platform}`,
  };
}
