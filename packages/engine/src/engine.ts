import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { ChatMessage, EngineMode, StreamEvent } from '@maniac/types';
import { callOpenCode } from './opencode';
import { executeToolCall, parseToolCalls, stripToolCalls } from './tools';
import { resolveToolCallsFromCompletion } from './openai-tools';
import { getSystemPrompt, CONTEXT_LIMIT } from './router';
import { saveMemory, saveUserProfile, readMemory } from './memory';
import { listSkills, viewSkill, createSkill } from './skills';
import { evaluateMemorySave } from './review';
import { shouldCompress, compressMessages } from './compressor';
import { delegateTask, waitForDelegation, getMaxSubagentConcurrency } from './delegation';
import { runPool } from './concurrency';
import { runCurator, getCuratorStatus, startCurator, stopCurator } from './curator';
import { touchLastActivity, enqueueProactiveMessage, proactivePulse } from './proactive';
import { runHooks, registerHook } from './hooks';
import {
  saveCheckpoint, flushCheckpoint, clearCheckpoint, heartbeat, loadCheckpoint,
  reportCrash, checkResume, cleanImmortalityState,
  immortalitySummary, getImmortalityStatus,
} from './immortality';
import { toolFingerprint } from './resume';
import { acquireRunLock, releaseRunLock } from './run-lock';
import { loadAutonomyConfig } from './autonomy';
import { detectAndEnqueueProposals, type ImprovementProposal } from './proposals';
import {
  evaluatePermission,
  loadPermissionConfig,
  addGrant,
  type PermissionMode,
} from './permissions';
import {
  appendChatMessage,
  appendSessionUpdate,
  createSession,
  type SessionSummary,
} from './session';
import { describeImages, buildVisionAugmentedMessage, getVisionModelLabel } from './vision';

let MAX_TOOL_ITERATIONS = 25;
const CWD = (() => {
  const engineSrc = __dirname;
  const candidates = [
    path.join(engineSrc, '..', '..', '..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
    } catch (e) {
      console.debug('[engine] Erro ao resolver CWD (resolveEnginePkg):', e);
    }
  }
  return process.cwd();
})();

const EMPTY_REPLY_MAX_RETRIES = 2;
const EMPTY_REPLY_NUDGE =
  'Continue. Your previous turn had no visible reply (thinking-only). ' +
  'Call tools or answer the user in plain text — do not only think.';
const DEFERRED_INTENT_NUDGE =
  'Continue from the tool results above. Do the next concrete step now ' +
  '(call tools or give a final answer). Do not only say you will explore.';

/** Short "I'll look into it" soft-quits after tools — free models do this a lot. */
export function looksLikeDeferredIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 320) return false;
  if (
    /\b(vou|i('ll| will)|let me|going to)\s+(explorar|olhar|ver|checar|investigar|mostrar|explore|check|look|dig|investigate|show)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\bmais a fundo\b|\bpanorama real\b/i.test(t)) return true;
  if (/^(ok[,.]?\s*)?(vou|deix[ae]|j[aá] vou|let me|i('ll| will))\b/i.test(t) && t.length < 160) {
    return true;
  }
  return false;
}

export function setMaxToolIterations(n: number): void {
  MAX_TOOL_ITERATIONS = Math.max(5, Math.min(n, 100));
}

export type PermissionPromptDecision = 'allow' | 'deny' | 'always';

interface EngineRunOptions {
  message: string;
  mode: EngineMode;
  history?: ChatMessage[];
  repoPath?: string;
  onEvent: (event: StreamEvent) => void;
  /** Interactive permission prompt. Required when evaluate returns `ask`. */
  onPermissionRequest?: (req: {
    id: string;
    tool: string;
    args: string;
    reason?: string;
  }) => Promise<PermissionPromptDecision>;
  /** Override permission mode for this run (else loaded from ~/.maniac/permissions.json). */
  permissionMode?: PermissionMode;
  /** Persist conversation under this session id (creates one if omitted and sessionEnabled). */
  sessionId?: string;
  /** When true (default), auto-create/append a session for this cwd. */
  sessionEnabled?: boolean;
  /** Cancels the run: stops the tool loop and kills any running exec process. */
  signal?: AbortSignal;
  /**
   * Absolute paths of images attached to this message. They are described by
   * the Groq vision model and the descriptions are injected into the prompt,
   * so text-only code models (NVIDIA/OpenCode) can work with them.
   */
  images?: string[];
}

export type { EngineRunOptions };

let sessionInit = false;

// ─── Global crash handlers (imortalidade) ─────────────────────────────────

function setupCrashHandlers(): void {
  if (typeof process !== 'undefined') {
    process.on('uncaughtException', (err) => {
      flushCheckpoint();
      reportCrash(err);
      heartbeat('running'); // último heartbeat antes de morrer
      console.error('[Immortality] ☠️ Crash detectado, checkpoint salvo. Detalhes em ~/.maniac/crash.json');
    });

    process.on('unhandledRejection', (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      flushCheckpoint();
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

async function authorizeTool(
  tool: string,
  args: string,
  opts: {
    cwd: string;
    mode: EngineMode;
    permissionMode?: PermissionMode;
    onEvent: (event: StreamEvent) => void;
    onPermissionRequest?: EngineRunOptions['onPermissionRequest'];
  },
): Promise<{ allowed: boolean; message?: string }> {
  const cfg = loadPermissionConfig();
  if (opts.permissionMode) cfg.mode = opts.permissionMode;

  const result = evaluatePermission(tool, args, cfg, {
    cwd: opts.cwd,
    engineMode: opts.mode,
  });

  if (result.decision === 'allow') return { allowed: true };
  if (result.decision === 'deny') {
    return { allowed: false, message: result.reason || `Permission denied for ${tool}` };
  }

  // ask
  const id = `perm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  opts.onEvent({
    type: 'permission_request',
    id,
    tool,
    args,
    reason: result.reason,
  });

  if (!opts.onPermissionRequest) {
    opts.onEvent({ type: 'permission_decision', id, decision: 'deny' });
    return {
      allowed: false,
      message: `Permission required for ${tool} but no interactive prompt is available (use CLI or set bypassPermissions)`,
    };
  }

  const decision = await opts.onPermissionRequest({
    id,
    tool,
    args,
    reason: result.reason,
  });

  opts.onEvent({ type: 'permission_decision', id, decision });

  if (decision === 'deny') {
    return { allowed: false, message: `User denied permission for ${tool}` };
  }
  if (decision === 'always') {
    const tokens = args.trim().split(/\s+/).filter(Boolean).slice(0, 3);
    // Never store a global grant (empty prefix would match everything).
    if (tokens.length === 0) {
      return { allowed: true };
    }
    addGrant(opts.cwd, { tool, prefix: tokens.join(' ') });
  }
  return { allowed: true };
}

async function runEngine(options: EngineRunOptions): Promise<string> {
  const {
    mode,
    history = [],
    repoPath,
    onEvent,
    onPermissionRequest,
    permissionMode,
    sessionEnabled = true,
    signal,
    images = [],
  } = options;
  let message = options.message;

  // ── Vision routing: describe attached images via Groq, inject text back ──
  if (images.length > 0) {
    const visionModel = getVisionModelLabel();
    onEvent({ type: 'tool_start', tool: 'vision', args: `${images.length} image(s) → ${visionModel}` });
    try {
      const descriptions = await describeImages(images, message);
      message = buildVisionAugmentedMessage(message, descriptions);
      const failed = descriptions.filter(d => d.description.startsWith('[falha')).length;
      onEvent({
        type: 'tool_result',
        tool: 'vision',
        success: failed === 0,
        output: descriptions
          .map((d, i) => `[image${i + 1}] ${d.description.slice(0, 120)}${d.description.length > 120 ? '…' : ''}`)
          .join('\n'),
      });
    } catch (e: any) {
      onEvent({ type: 'tool_result', tool: 'vision', success: false, output: e.message });
      message += `\n\n[NOTA: ${images.length} imagem(ns) anexada(s), mas o modelo de visao falhou: ${e.message}]`;
    }
  }

  if (!sessionInit) {
    startCurator();
    heartbeat('idle');
    setupCrashHandlers();
    setInterval(() => heartbeat('idle'), 15000);

    // Built-in audit hook: log destructive tool calls to ~/.maniac/audit.log
    const AUDIT_TOOLS = new Set(['write', 'edit', 'exec', 'source_edit', 'rebuild_engine', 'self_restart', 'proposal_apply']);
    const auditPath = path.join(os.homedir(), '.maniac', 'audit.log');
    registerHook('*', 'post', (ctx) => {
      if (!AUDIT_TOOLS.has(ctx.tool)) return;
      const ts = new Date().toISOString();
      const line = `${ts}  ${ctx.tool}  ${ctx.args.slice(0, 120).replace(/\n/g, '↵')}  →  ${ctx.result?.success ? 'ok' : 'fail'}\n`;
      try {
        fs.mkdirSync(path.dirname(auditPath), { recursive: true });
        fs.appendFileSync(auditPath, line);
      } catch (e) {
        console.debug('[engine] audit log falhou:', e);
      }
    });

    // Proposal-only autonomy: detect opportunities; never apply in background
    const autoCfg = loadAutonomyConfig();
    setInterval(() => {
      try {
        const props = detectAndEnqueueProposals();
        if (props.length) {
          enqueueProactiveMessage(
            `New improvement proposals (${props.length}): ${props.map((p: ImprovementProposal) => p.id).join(', ')}. Review with /proposals or approve with /approve <id>.`,
          );
        }
      } catch (e) {
        console.warn('[engine] proposal detect falhou:', e);
      }
    }, autoCfg.proposalIntervalMs);
    setInterval(() => {
      void proactivePulse().then((t) => {
        if (t) enqueueProactiveMessage(t);
      });
    }, 30 * 60 * 1000);

    sessionInit = true;
  }

  const toolCwd = repoPath || CWD;
  let session: SessionSummary | null = null;
  if (sessionEnabled) {
    if (options.sessionId) {
      session = { id: options.sessionId, cwd: toolCwd, title: '', createdAt: 0, updatedAt: 0, numMessages: 0 };
    } else {
      session = createSession(toolCwd);
    }
    onEvent({ type: 'session', sessionId: session.id });
    appendChatMessage(toolCwd, session.id, { role: 'user', content: message });
  }

  const permCfg = loadPermissionConfig();
  onEvent({ type: 'mode', mode });
  onEvent({ type: 'permission_mode', mode: permissionMode || permCfg.mode });

  let finalReply = '';
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const runLock = acquireRunLock(toolCwd, runId);

  try {
    const systemPrompt = getSystemPrompt(mode, repoPath);
    let messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ];

    finalReply = '';
    let toolIter = 0;
    let emptyReplyRetries = 0;
    let deferredIntentNudged = false;
    let hadToolsThisRun = false;
    const allToolCalls: { type: string; success: boolean }[] = [];

  while (toolIter < MAX_TOOL_ITERATIONS) {
    if (signal?.aborted) {
      onEvent({ type: 'error', message: 'aborted by user' });
      onEvent({ type: 'done' });
      heartbeat('idle');
      if (runLock) releaseRunLock(runLock.token);
      return finalReply;
    }
    if (shouldCompress(messages, CONTEXT_LIMIT)) {
      messages = compressMessages(messages, CONTEXT_LIMIT);
    }

    let reply = '';
    let completionToolCalls: { type: string; command: string }[] = [];
    try {
      const completion = await callOpenCode(messages, onEvent);
      reply = completion.content;
      completionToolCalls = resolveToolCallsFromCompletion(completion, parseToolCalls, {
        recoverShellFences: true,
      });
    } catch (e: any) {
      onEvent({ type: 'error', message: e.message });
      if (runLock) releaseRunLock(runLock.token);
      return finalReply || `Erro: ${e.message}`;
    }

    const toolCalls = completionToolCalls;

    if (toolCalls.length === 0) {
      const visible = stripToolCalls(reply) || reply.trim();

      // Free/reasoning models often stream CoT then emit zero visible tokens.
      if (!visible && emptyReplyRetries < EMPTY_REPLY_MAX_RETRIES && !signal?.aborted) {
        emptyReplyRetries++;
        onEvent({
          type: 'compact',
          summary: `empty reply (thinking-only) — retry ${emptyReplyRetries}/${EMPTY_REPLY_MAX_RETRIES}`,
        });
        messages.push({
          role: 'assistant',
          content: reply.trim() || '(thinking only, no visible text)',
        });
        messages.push({ role: 'user', content: EMPTY_REPLY_NUDGE });
        toolIter++;
        continue;
      }

      // After tools: "vou explorar mais…" then idle — nudge once to actually continue.
      if (
        visible &&
        hadToolsThisRun &&
        !deferredIntentNudged &&
        looksLikeDeferredIntent(visible) &&
        !signal?.aborted
      ) {
        deferredIntentNudged = true;
        onEvent({
          type: 'compact',
          summary: 'soft-quit after tools — nudging model to continue',
        });
        messages.push({ role: 'assistant', content: reply });
        messages.push({ role: 'user', content: DEFERRED_INTENT_NUDGE });
        toolIter++;
        continue;
      }

      finalReply = visible;
      if (!visible) {
        onEvent({
          type: 'error',
          message: 'model returned an empty reply (thinking-only). try again or /model',
        });
      }
      break;
    }

    hadToolsThisRun = true;
    emptyReplyRetries = 0;
    const cleanReply = stripToolCalls(reply);
    // Do NOT emit cleanReply as `reasoning` — that dumped the assistant text
    // (and any leaked CoT) into the UI / headless "thought" channel.

    messages.push({ role: 'assistant', content: reply });

    // Checkpoint v2 before executing tools (idempotency ledger)
    const batchCalls: import('./immortality').CheckpointToolCall[] = toolCalls.map((tc, i) => ({
      id: toolFingerprint(tc.type, tc.command, i),
      type: tc.type,
      args: tc.command,
      status: 'pending',
    }));
    const checkpointBase = () => ({
      messages,
      mode,
      lastUserMessage: message,
      lastAssistantReply: cleanReply || finalReply,
      toolExecutionIndex: toolIter,
      totalToolExecutions: MAX_TOOL_ITERATIONS,
      runId,
      sessionId: session?.id ?? null,
      phase: 'executing_tools' as const,
      permissionMode: permissionMode || permCfg.mode,
      repoPath: toolCwd,
      toolBatch: { assistantRaw: reply, calls: batchCalls, toolIter },
      lockToken: runLock?.token,
    });
    saveCheckpoint(checkpointBase());
    heartbeat('busy');

    const markBatch = (index: number, success: boolean, output: string) => {
      if (index < 0 || index >= batchCalls.length) return;
      batchCalls[index].status = success ? 'done' : 'failed';
      batchCalls[index].resultPreview = output.slice(0, 2000);
      saveCheckpoint(checkpointBase());
    };

    for (let ti = 0; ti < toolCalls.length; ti++) {
      if (signal?.aborted) break;
      const tc = toolCalls[ti];
      allToolCalls.push({ type: tc.type, success: false });

      if (tc.type === 'memory_save') {
        const result = saveMemory(tc.command);
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        markBatch(ti, result.success, result.output);
        continue;
      }

      if (tc.type === 'profile_save') {
        const result = saveUserProfile(tc.command);
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        markBatch(ti, result.success, result.output);
        continue;
      }

      if (tc.type === 'memory_read') {
        const result = readMemory();
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        markBatch(ti, result.success, result.output);
        continue;
      }

      if (tc.type === 'skill_view') {
        const result = viewSkill(tc.command.trim());
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        markBatch(ti, result.success, result.output);
        continue;
      }

      if (tc.type === 'skill_create') {
        const parts = tc.command.split('|');
        if (parts.length < 3) {
          const err = { success: false, output: 'formato: nome|descricao|conteudo' };
          onEvent({ type: 'tool_result', tool: tc.type, ...err });
          messages.push({ role: 'user', content: `[RESULTADO]\n${err.output}` });
          markBatch(ti, false, err.output);
          continue;
        }
        const result = createSkill(parts[0].trim(), parts[1].trim(), parts.slice(2).join('|').trim());
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        markBatch(ti, result.success, result.output);
        continue;
      }

      // Consecutive [TOOL:delegate] calls fan out in parallel (bounded).
      if (tc.type === 'delegate') {
        const wave: typeof toolCalls = [];
        let j = ti;
        while (j < toolCalls.length && toolCalls[j].type === 'delegate') {
          wave.push(toolCalls[j]);
          j++;
        }
        // We already pushed one allToolCalls entry for ti; add the rest
        for (let k = 1; k < wave.length; k++) {
          allToolCalls.push({ type: 'delegate', success: false });
        }

        const auth = await authorizeTool('delegate', wave.map((w) => w.command).join(' || '), {
          cwd: toolCwd,
          mode,
          permissionMode,
          onEvent,
          onPermissionRequest,
        });
        if (!auth.allowed) {
          const out = auth.message || 'Permission denied';
          for (let k = 0; k < wave.length; k++) {
            onEvent({ type: 'tool_result', tool: 'delegate', success: false, output: out });
            messages.push({ role: 'user', content: `[RESULTADO]\n${out}` });
            markBatch(ti + k, false, out);
          }
          ti = j - 1;
          continue;
        }

        const waveStartIdx = allToolCalls.length - wave.length;
        onEvent({ type: 'subagents_dispatch', count: wave.length });
        const results = await runPool(wave, getMaxSubagentConcurrency(), async (item, idx) => {
          const parsed = parseDelegateCommand(item.command);
          if (!parsed) {
            return {
              id: `sub_invalid_${idx}`,
              success: false,
              summary: 'formato: objetivo|contexto|ferramentas(opcional) — tools: ls,read,grep,glob,exec',
            };
          }
          const { goal, context, tools } = parsed;
          const id = `sub_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`;
          delegateTask(
            goal,
            context,
            tools,
            {
              onToken: (chunk) => onEvent({ type: 'subagent_token', id, content: chunk }),
              onToolStart: (tool) => onEvent({ type: 'subagent_tool', id, tool, done: false }),
              onToolDone: (tool, success) =>
                onEvent({ type: 'subagent_tool', id, tool, done: true, success }),
            },
            { id, cwd: toolCwd, signal, permissionMode, onPermissionRequest },
          );
          onEvent({ type: 'subagent_start', id, goal });
          const result = await waitForDelegation(id);
          return {
            id,
            success: result?.success ?? false,
            summary: result?.summary ?? '[failed]',
          };
        });

        for (let k = 0; k < results.length; k++) {
          const r = results[k];
          allToolCalls[waveStartIdx + k].success = r.success;
          onEvent({
            type: 'subagent_done',
            id: r.id,
            success: r.success,
            summary: r.summary,
          });
          messages.push({
            role: 'user',
            content: `[RESULTADO SUBAGENTE ${r.id} | index=${ti + k}]\n${r.summary}`,
          });
          markBatch(ti + k, r.success, r.summary);
        }
        ti = j - 1;
        continue;
      }

      if (tc.type === 'curator_run') {
        const result = runCurator();
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        markBatch(ti, result.success, result.output);
        continue;
      }

      if (tc.type === 'curator_status') {
        const result = getCuratorStatus();
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: result.success, output: result.output });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        markBatch(ti, result.success, result.output);
        continue;
      }

      if (tc.type.includes('/')) {
        const auth = await authorizeTool(tc.type, tc.command, {
          cwd: toolCwd,
          mode,
          permissionMode,
          onEvent,
          onPermissionRequest,
        });
        if (!auth.allowed) {
          const out = auth.message || 'Permission denied';
          onEvent({ type: 'tool_start', tool: tc.type, args: tc.command });
          onEvent({ type: 'tool_result', tool: tc.type, success: false, output: out });
          messages.push({ role: 'user', content: `[RESULTADO MCP ${tc.type}]\n${out}` });
          markBatch(ti, false, out);
          continue;
        }
        onEvent({ type: 'tool_start', tool: tc.type, args: tc.command });
        let mcpResult: { success: boolean; output: string };
        if (tc.type === 'brain/save' || tc.type === 'brain/read' || tc.type === 'brain/search') {
          const mappedTool = tc.type === 'brain/save' ? 'obsidian/write_note'
            : tc.type === 'brain/read' ? 'obsidian/read_note'
            : 'obsidian/search_notes';
          mcpResult = await executeMcpTool(mappedTool, tc.command);
        } else {
          mcpResult = await executeMcpTool(tc.type, tc.command);
        }
        allToolCalls[allToolCalls.length - 1].success = mcpResult.success;
        onEvent({ type: 'tool_result', tool: tc.type, success: mcpResult.success, output: mcpResult.output });
        if (session) appendSessionUpdate(toolCwd, session.id, { type: 'tool_result', tool: tc.type, success: mcpResult.success, output: mcpResult.output.slice(0, 500) });
        messages.push({
          role: 'user',
          content: `[RESULTADO MCP ${tc.type}]\n${mcpResult.output}`,
        });
        markBatch(ti, mcpResult.success, mcpResult.output);
      } else {
        const auth = await authorizeTool(tc.type, tc.command, {
          cwd: toolCwd,
          mode,
          permissionMode,
          onEvent,
          onPermissionRequest,
        });
        if (!auth.allowed) {
          const out = auth.message || 'Permission denied';
          onEvent({ type: 'tool_start', tool: tc.type, args: tc.command });
          onEvent({ type: 'tool_result', tool: tc.type, success: false, output: out });
          messages.push({ role: 'user', content: `[RESULTADO]\n${out}` });
          markBatch(ti, false, out);
          continue;
        }
        onEvent({ type: 'tool_start', tool: tc.type, args: tc.command });
        await runHooks('pre', { tool: tc.type, args: tc.command, cwd: toolCwd });
        const result = await executeToolCall(tc.type, tc.command, toolCwd, {
          signal,
          onOutput: (chunk) => onEvent({ type: 'tool_output', tool: tc.type, chunk }),
        });
        await runHooks('post', { tool: tc.type, args: tc.command, cwd: toolCwd, result });
        allToolCalls[allToolCalls.length - 1].success = result.success;
        onEvent({
          type: 'tool_result',
          tool: tc.type,
          success: result.success,
          output: result.output.slice(0, 4000),
        });
        if (session) appendSessionUpdate(toolCwd, session.id, { type: 'tool_result', tool: tc.type, success: result.success, output: result.output.slice(0, 500) });
        messages.push({
          role: 'user',
          content: `[RESULTADO]\n${result.output.slice(0, 4000)}`,
        });
        markBatch(ti, result.success, result.output);
      }
    }

    toolIter++;
  }

  const hitMaxIterations = toolIter >= MAX_TOOL_ITERATIONS;
  if (hitMaxIterations) {
    const msg =
      `max tool iterations (${MAX_TOOL_ITERATIONS}) reached — task paused mid-run. ` +
      `Send another message (or /continue) to keep going.`;
    onEvent({ type: 'error', message: msg });
    if (!finalReply) finalReply = msg;
    flushCheckpoint();
  }

  onEvent({ type: 'done' });

  touchLastActivity();

  // Keep checkpoint when we paused mid-run so /continue / resume can pick up.
  if (!hitMaxIterations) clearCheckpoint();
  heartbeat(hitMaxIterations ? 'busy' : 'idle');
  if (runLock) releaseRunLock(runLock.token);

  if (finalReply) {
    if (session) {
      appendChatMessage(toolCwd, session.id, { role: 'assistant', content: finalReply });
      appendSessionUpdate(toolCwd, session.id, { type: 'done' });
    }
    evaluateMemorySave({
      userMessage: message,
      assistantReply: finalReply,
      toolCalls: allToolCalls,
    });
  }

  return finalReply;
  } catch (e: any) {
    // Engine-level crash: keep useful v2 checkpoint; only write minimal if none
    const errMsg = e?.message || String(e);
    const existing = loadCheckpoint();
    if (!existing?.toolBatch) {
      saveCheckpoint({
        messages: [{ role: 'system', content: '' }, { role: 'user', content: message }],
        mode,
        lastUserMessage: message,
        lastAssistantReply: '',
        toolExecutionIndex: 0,
        totalToolExecutions: MAX_TOOL_ITERATIONS,
        runId,
        sessionId: session?.id ?? null,
        phase: 'executing_tools',
        repoPath: toolCwd,
      });
    }
    reportCrash(e instanceof Error ? e : new Error(errMsg));
    flushCheckpoint();
    onEvent({ type: 'error', message: errMsg });
    if (runLock) releaseRunLock(runLock.token);
    return finalReply || `Erro no engine: ${errMsg}`;
  }
}

export { runEngine };

const DELEGATE_TOOLS = new Set(['ls', 'read', 'write', 'edit', 'grep', 'glob', 'exec']);

/** Parse `goal|context|tools` and tolerate `goal: …|context: …|tools: ls,exec` from models. */
function parseDelegateCommand(
  command: string,
): { goal: string; context: string; tools?: string[] } | null {
  const parts = command.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const stripLabel = (s: string, labels: string[]) => {
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*:\\s*`, 'i');
      if (re.test(s)) return s.replace(re, '').trim();
    }
    return s;
  };

  const goal = stripLabel(parts[0], ['goal', 'objetivo', 'task']);
  const context = stripLabel(parts[1], ['context', 'contexto', 'ctx']);
  if (!goal || !context) return null;

  let tools: string[] | undefined;
  if (parts[2]) {
    const raw = stripLabel(parts[2], ['tools', 'ferramentas', 'tool']);
    const named = raw
      .split(/[,;\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => DELEGATE_TOOLS.has(t));
    // Ignore prose tool lists like "disk analyzer" — fall back to defaults
    tools = named.length > 0 ? named : undefined;
  }

  return { goal, context, tools };
}

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

  // Try persistent MCP client first (new system)
  try {
    const { findMcpTool, callMcpTool } = require('./mcp');
    const mcpTool = findMcpTool(toolKey) || findMcpTool(toolName);
    if (mcpTool) {
      return await callMcpTool(mcpTool.qualifiedName, args);
    }
  } catch (e) {
    console.warn('[engine] MCP call fallback falhou:', e);
  }

  // Fallback: search config files for server definition
  const home = os.homedir();
  const candidatePaths = [
    process.env.MCP_CONFIG_PATH || '',
    process.env.OPENCODE_CONFIG || '',
    path.join(home, '.config', 'opencode', 'opencode.jsonc'),
    path.join(home, '.config', 'opencode', 'opencode.json'),
    path.join(home, '.gemini', 'config', 'mcp_config.json'),
    path.join(home, '.maniac', 'mcp.json'),
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw.replace(/\/\/.*$/gm, ''));
      const server = data.mcpServers?.[serverName] || data.mcp?.[serverName];
      if (server) return await callMcpServer(server, toolName, args);
    } catch (e) {
      console.debug(`[engine] config ${p} falhou:`, e);
    }
  }

  return { success: false, output: `Servidor MCP "${serverName}" nao encontrado. Use [TOOL:mcp] para configurar.` };
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
  return new Promise((resolve) => {
    if (!config.command) {
      resolve({ success: false, output: 'Comando MCP nao configurado' });
      return;
    }

    // Whitelist: only pass known-safe env vars + MCP-specific ones (never leak secrets)
    const SAFE_ENV_KEYS = new Set([
      'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP',
      'SystemRoot', 'windir', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
      'NODE_PATH',
    ]);
    const safeEnv: Record<string, string> = {};
    for (const key of SAFE_ENV_KEYS) {
      if (process.env[key]) safeEnv[key] = process.env[key]!;
    }
    if (config.env) Object.assign(safeEnv, config.env);

    const child = spawn(config.command, config.args || [], {
      shell: process.env.SHELL || 'cmd.exe',
      env: safeEnv,
    });

    let stdoutData = '';
    let resolved = false;
    let timeout: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      try { child.stdin.end(); } catch (e) { console.debug('[engine] stdin end falhou:', e); }
      try { child.kill(); } catch (e) { console.debug('[engine] child kill falhou:', e); }
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
        } catch (e) {
          console.debug('[engine] parse response falhou:', e);
        }
      }
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
