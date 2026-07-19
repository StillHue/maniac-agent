import * as path from 'path';
import { ChatMessage, EngineMode, StreamEvent } from '@maniac/types';
import { callOpenCode } from './opencode';
import { executeToolCall, parseToolCalls, stripToolCalls } from './tools';
import { getSystemPrompt, CONTEXT_LIMIT } from './router';
import { saveMemory, saveUserProfile, readMemory } from './memory';
import { listSkills, viewSkill, createSkill } from './skills';
import { evaluateMemorySave } from './review';
import { shouldCompress, compressMessages } from './compressor';
import { delegateTask, waitForDelegation } from './delegation';
import { runCurator, getCuratorStatus, startCurator, stopCurator } from './curator';
import { touchLastActivity } from './proactive';
import { runHooks, registerHook } from './hooks';
import {
  saveCheckpoint, clearCheckpoint, heartbeat,
  reportCrash, checkResume, cleanImmortalityState,
  immortalitySummary, getImmortalityStatus,
} from './immortality';

let MAX_TOOL_ITERATIONS = 50;
const CWD = (() => {
  const engineSrc = __dirname;
  const candidates = [
    path.join(engineSrc, '..', '..', '..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    try {
      if (require('fs').existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
    } catch {}
  }
  return process.cwd();
})();

export function setMaxToolIterations(n: number): void {
  MAX_TOOL_ITERATIONS = Math.max(5, Math.min(n, 500));
}

interface EngineRunOptions {
  message: string;
  mode: EngineMode;
  history?: ChatMessage[];
  repoPath?: string;
  onEvent: (event: StreamEvent) => void;
}

export type { EngineRunOptions };

let sessionInit = false;

// ─── Global crash handlers (imortalidade) ─────────────────────────────────

function setupCrashHandlers(): void {
  if (typeof process !== 'undefined') {
    process.on('uncaughtException', (err) => {
      reportCrash(err);
      heartbeat('running'); // último heartbeat antes de morrer
      console.error('[Immortality] ☠️ Crash detectado, checkpoint salvo. Detalhes em ~/.maniac/crash.json');
    });

    process.on('unhandledRejection', (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      reportCrash(err);
      heartbeat('running');
      console.error('[Immortality] ☠️ Unhandled rejection detectada, checkpoint salvo.');
    });

    process.on('SIGTERM', () => {
      console.log('[Immortality] SIGTERM recebido, salvando checkpoint...');
      heartbeat('running');
    });
  }
}

async function runEngine(options: EngineRunOptions): Promise<string> {
  const { message, mode, history = [], repoPath, onEvent } = options;

  if (!sessionInit) {
    startCurator();
    heartbeat('idle');
    setupCrashHandlers();
    setInterval(() => heartbeat('idle'), 15000);

    // Built-in audit hook: log destructive tool calls to ~/.maniac/audit.log
    const AUDIT_TOOLS = new Set(['write', 'edit', 'exec', 'source_edit', 'rebuild_engine', 'self_restart']);
    const auditPath = require('path').join(require('os').homedir(), '.maniac', 'audit.log');
    const { appendFileSync, mkdirSync } = require('fs');
    registerHook('*', 'post', (ctx) => {
      if (!AUDIT_TOOLS.has(ctx.tool)) return;
      const ts = new Date().toISOString();
      const line = `${ts}  ${ctx.tool}  ${ctx.args.slice(0, 120).replace(/\n/g, '↵')}  →  ${ctx.result?.success ? 'ok' : 'fail'}\n`;
      try {
        mkdirSync(require('path').dirname(auditPath), { recursive: true });
        appendFileSync(auditPath, line);
      } catch {}
    });

    sessionInit = true;
  }

  onEvent({ type: 'mode', mode });

  let finalReply = '';

  try {
    const systemPrompt = getSystemPrompt(mode, repoPath);
    let messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ];

    finalReply = '';
    let toolIter = 0;
    const allToolCalls: { type: string; success: boolean }[] = [];

  while (toolIter < MAX_TOOL_ITERATIONS) {
    if (shouldCompress(messages, CONTEXT_LIMIT)) {
      messages = compressMessages(messages, CONTEXT_LIMIT);
    }

    let reply = '';
    try {
      reply = await callOpenCode(messages, onEvent);
    } catch (e: any) {
      onEvent({ type: 'error', message: e.message });
      return finalReply || `Erro: ${e.message}`;
    }

    const toolCalls = parseToolCalls(reply);

    if (toolCalls.length === 0) {
      finalReply = reply;
      break;
    }

    const cleanReply = stripToolCalls(reply);
    if (cleanReply) {
      onEvent({ type: 'reasoning', content: cleanReply });
    }

    messages.push({ role: 'assistant', content: reply });

    // Checkpoint antes de executar ferramentas (imortalidade)
    saveCheckpoint({
      messages,
      mode,
      lastUserMessage: message,
      lastAssistantReply: cleanReply || finalReply,
      toolExecutionIndex: toolIter,
      totalToolExecutions: MAX_TOOL_ITERATIONS,
    });
    heartbeat('busy');

    for (const tc of toolCalls) {
      allToolCalls.push({ type: tc.type, success: false });

      if (tc.type === 'memory_save') {
        const result = saveMemory(tc.command);
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        continue;
      }

      if (tc.type === 'profile_save') {
        const result = saveUserProfile(tc.command);
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        continue;
      }

      if (tc.type === 'memory_read') {
        const result = readMemory();
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        continue;
      }

      if (tc.type === 'skill_view') {
        const result = viewSkill(tc.command.trim());
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        continue;
      }

      if (tc.type === 'skill_create') {
        const parts = tc.command.split('|');
        if (parts.length < 3) {
          const err = { success: false, output: 'formato: nome|descricao|conteudo' };
          onEvent({ type: 'tool_result', tool: tc.type, ...err });
          messages.push({ role: 'user', content: `[RESULTADO]\n${err.output}` });
          continue;
        }
        const result = createSkill(parts[0].trim(), parts[1].trim(), parts.slice(2).join('|').trim());
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        continue;
      }

      if (tc.type === 'delegate') {
        const parts = tc.command.split('|');
        if (parts.length < 2) {
          const err = { success: false, output: 'formato: objetivo|contexto|ferramentas(opcional)' };
          onEvent({ type: 'tool_result', tool: tc.type, ...err });
          messages.push({ role: 'user', content: `[RESULTADO]\n${err.output}` });
          continue;
        }
        const goal    = parts[0].trim();
        const context = parts[1].trim();
        const tools   = parts[2] ? parts[2].trim().split(',').map(t => t.trim()) : undefined;
        const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

        onEvent({ type: 'subagent_start', id, goal });

        const result = await waitForDelegation(
          delegateTask(goal, context, tools, {
            onToken:    (chunk) => onEvent({ type: 'subagent_token', id, content: chunk }),
            onToolStart: (tool, args) => onEvent({ type: 'subagent_tool', id, tool, done: false }),
            onToolDone:  (tool, success) => onEvent({ type: 'subagent_tool', id, tool, done: true, success }),
          }),
        );

        if (result) {
          allToolCalls[allToolCalls.length - 1].success = result.success;
          onEvent({ type: 'subagent_done', id, success: result.success, summary: result.summary });
          messages.push({ role: 'user', content: `[RESULTADO SUBAGENTE ${id}]\n${result.summary}` });
        }
        continue;
      }

      if (tc.type === 'curator_run') {
        const result = runCurator();
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        continue;
      }

      if (tc.type === 'curator_status') {
        const result = getCuratorStatus();
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        continue;
      }

      if (tc.type.includes('/')) {
        onEvent({ type: 'tool_start', tool: tc.type, args: tc.command });
        let mcpResult: { success: boolean; output: string };
        if (tc.type === 'brain/save' || tc.type === 'brain/read' || tc.type === 'brain/search') {
          const mappedTool = tc.type === 'brain/save' ? 'obsidian/write_note'
            : tc.type === 'brain/read' ? 'obsidian/read_note'
            : 'obsidian/search_notes';
          const slashIdx = mappedTool.indexOf('/');
          const mappedServer = mappedTool.slice(0, slashIdx);
          const mappedName = mappedTool.slice(slashIdx + 1);
          mcpResult = await executeMcpTool(mappedServer + '/' + mappedName, tc.command);
        } else {
          mcpResult = await executeMcpTool(tc.type, tc.command);
        }
        allToolCalls[allToolCalls.length - 1].success = mcpResult.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: mcpResult.success, output: mcpResult.output });
        messages.push({
          role: 'user',
          content: `[RESULTADO MCP ${tc.type}]\n${mcpResult.output}`,
        });
      } else {
        const toolCwd = repoPath || CWD;
        onEvent({ type: 'tool_start', tool: tc.type, args: tc.command });
        await runHooks('pre', { tool: tc.type, args: tc.command, cwd: toolCwd });
        const result = await executeToolCall(tc.type, tc.command, toolCwd);
        await runHooks('post', { tool: tc.type, args: tc.command, cwd: toolCwd, result });
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({
          type: 'tool_result',
          tool: tc.type,
          success: result.success,
          output: result.output.slice(0, 4000),
        });
        messages.push({
          role: 'user',
          content: `[RESULTADO]\n${result.output.slice(0, 4000)}`,
        });
      }
    }

    toolIter++;
  }

  onEvent({ type: 'done' });

  touchLastActivity();

  // Checkpoint limpo após execução bem-sucedida
  clearCheckpoint();
  heartbeat('idle');

  if (finalReply) {
    evaluateMemorySave({
      userMessage: message,
      assistantReply: finalReply,
      toolCalls: allToolCalls,
    });
  }

  return finalReply;
  } catch (e: any) {
    // Engine-level crash: salva checkpoint para recovery
    const errMsg = e?.message || String(e);
    saveCheckpoint({
      messages: [{ role: 'system', content: '' }, { role: 'user', content: message }],
      mode,
      lastUserMessage: message,
      lastAssistantReply: '',
      toolExecutionIndex: 0,
      totalToolExecutions: MAX_TOOL_ITERATIONS,
    });
    reportCrash(e instanceof Error ? e : new Error(errMsg));
    onEvent({ type: 'error', message: errMsg });
    return finalReply || `Erro no engine: ${errMsg}`;
  }
}

export { runEngine };

async function executeMcpTool(toolKey: string, argsString: string): Promise<{ success: boolean; output: string }> {
  const slashIdx = toolKey.indexOf('/');
  if (slashIdx === -1) {
    return { success: false, output: `Chave MCP invalida: ${toolKey}` };
  }
  const serverName = toolKey.slice(0, slashIdx);
  const toolName = toolKey.slice(slashIdx + 1);

  let args: any = {};
  try {
    args = JSON.parse(argsString);
  } catch {
    return { success: false, output: `Falha ao analisar args MCP: ${argsString}` };
  }

  const opencodePaths = [
    'C:\\Users\\gabdr\\.config\\opencode\\opencode.jsonc',
    'C:\\Users\\gabdr\\.config\\opencode\\opencode.json',
  ];
  for (const p of opencodePaths) {
    try {
      const raw = require('fs').readFileSync(p, 'utf8');
      const data = JSON.parse(raw.replace(/\/\/.*$/gm, ''));
      if (data.mcp?.[serverName]) {
        return await callMcpServer(data.mcp[serverName], toolName, args);
      }
    } catch {}
  }

  const geminiPaths = [
    'C:\\Users\\gabdr\\.gemini\\config\\mcp_config.json',
    'C:\\Users\\gabdr\\Pedro\\mcp_config.local.json',
  ];
  for (const p of geminiPaths) {
    try {
      const data = JSON.parse(require('fs').readFileSync(p, 'utf8'));
      const server = data.mcpServers?.[serverName];
      if (server) {
        return await callMcpServer(server, toolName, args);
      }
    } catch {}
  }

  const mcpConfigPath = process.env.MCP_CONFIG_PATH || '';
  if (mcpConfigPath) {
    try {
      const data = JSON.parse(require('fs').readFileSync(mcpConfigPath, 'utf8'));
      const server = data.mcpServers?.[serverName] || data.mcp?.[serverName];
      if (server) return await callMcpServer(server, toolName, args);
    } catch {}
  }

  return { success: false, output: `Servidor MCP "${serverName}" nao encontrado` };
}

async function callMcpServer(config: any, toolName: string, args: any): Promise<{ success: boolean; output: string }> {
  if (config.type === 'remote' || config.url) {
    return await callHttpMcp(config, toolName, args);
  }
  return await spawnMcpServer(config, toolName, args);
}

async function callHttpMcp(config: any, toolName: string, args: any): Promise<{ success: boolean; output: string }> {
  const url = config.url || config.endpoint;
  if (!url) return { success: false, output: 'URL nao configurada para MCP remoto' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(config.headers || {}) };
  const requestId = Date.now();

  try {
    const listRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/list',
        params: {},
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!listRes.ok) {
      return { success: false, output: `MCP HTTP ${listRes.status}: ${await listRes.text().catch(() => '')}` };
    }

    const callRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId + 1,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!callRes.ok) {
      return { success: false, output: `MCP call HTTP ${callRes.status}: ${await callRes.text().catch(() => '')}` };
    }

    const data = await callRes.json();
    if (data.error) {
      return { success: false, output: data.error.message || JSON.stringify(data.error) };
    }
    return { success: true, output: JSON.stringify(data.result) };
  } catch (e: any) {
    return { success: false, output: `Erro MCP HTTP: ${e.message}` };
  }
}

async function spawnMcpServer(config: any, toolName: string, args: any): Promise<{ success: boolean; output: string }> {
  const { spawn } = require('child_process');

  return new Promise((resolve) => {
    if (!config.command) {
      resolve({ success: false, output: 'Comando MCP nao configurado' });
      return;
    }

    const child = spawn(config.command, config.args || [], {
      shell: process.env.SHELL || 'cmd.exe',
      env: { ...process.env, ...config.env },
    });

    let stdoutData = '';
    let resolved = false;
    let timeout: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString();
      const lines = stdoutData.split('\n');

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const response = JSON.parse(line);

          if (response.id === 1) {
            child.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: toolName, arguments: args },
            }) + '\n');
          } else if (response.id === 2) {
            resolved = true;
            cleanup();
            if (response.error) {
              resolve({ success: false, output: response.error.message || JSON.stringify(response.error) });
            } else {
              resolve({ success: true, output: JSON.stringify(response.result) });
            }
          }
        } catch {}
      }

      stdoutData = lines[lines.length - 1];
    });

    child.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, output: `Erro MCP: ${err.message}` });
      }
    });

    child.on('exit', (code: number | null) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, output: `Processo MCP encerrou (codigo ${code})` });
      }
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ares-engine', version: '1.0.0' },
      },
    }) + '\n');

    timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, output: 'Timeout MCP (15s)' });
      }
    }, 15000);
  });
}
