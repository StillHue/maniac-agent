import { ChatMessage } from '@maniac/types';
import { callOpenCode } from './opencode';
import { executeToolCall, parseToolCalls, stripToolCalls } from './tools';
import type { PermissionMode } from './permissions';
import type { PermissionPromptDecision } from './engine';

const MAX_CHILD_ITERATIONS = 20;
const BLOCKED_TOOLS = new Set([
  'delegate',
  'memory_save',
  'profile_save',
  'brain/save',
  'obsidian/vault_write',
  'source_edit',
  'rebuild_engine',
  'skill_create',
  'system_prompt_edit',
  'proposal_apply',
  'self_restart',
]);

let MAX_SUBAGENT_CONCURRENCY = 3;

export function setMaxSubagentConcurrency(n: number): void {
  MAX_SUBAGENT_CONCURRENCY = Math.max(1, Math.min(8, n));
}

export function getMaxSubagentConcurrency(): number {
  return MAX_SUBAGENT_CONCURRENCY;
}

export interface SubagentConfig {
  goal: string;
  context: string;
  tools?: string[];
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  permissionMode?: PermissionMode;
  onPermissionRequest?: (req: {
    id: string;
    tool: string;
    args: string;
    reason?: string;
  }) => Promise<PermissionPromptDecision>;
}

export interface SubagentResult {
  success: boolean;
  summary: string;
  tokenCount: number;
}

export interface SubagentCallbacks {
  onToken?: (chunk: string) => void;
  onToolStart?: (tool: string, args: string) => void;
  onToolDone?: (tool: string, success: boolean) => void;
}

export async function runSubagent(
  config: SubagentConfig,
  callbacks: SubagentCallbacks = {},
): Promise<SubagentResult> {
  const toolList = (config.tools || ['ls', 'read', 'write', 'edit', 'grep', 'glob', 'exec']).filter(
    (t) => !BLOCKED_TOOLS.has(t),
  );

  const systemPrompt = `You are a focused subagent of Maniac. You have one job: complete the task below.

Task: ${config.goal}

Context: ${config.context}

Available tools: ${toolList.map((t) => `[TOOL:${t}]`).join(', ')}

Rules:
- Stay focused. Do not deviate from the task.
- Blocked tools: ${[...BLOCKED_TOOLS].join(', ')} — do not use them.
- When finished, summarize what you did in 1–2 paragraphs.
- Do NOT ask questions. Just execute.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: config.goal },
  ];

  let finalReply = '';
  let tokenCount = 0;
  const cwd = config.cwd || process.cwd();
  const timeoutMs = config.timeoutMs ?? 180_000;
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  config.signal?.addEventListener('abort', onParentAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let iter = 0; iter < MAX_CHILD_ITERATIONS; iter++) {
      if (controller.signal.aborted) {
        return { success: false, summary: '[cancelled|timeout]', tokenCount };
      }

      let reply = '';
      try {
        reply = await callOpenCode(messages, (event) => {
          if (event.type === 'token') callbacks.onToken?.(event.content);
        });
      } catch {
        break;
      }

      tokenCount += reply.length;
      const toolCalls = parseToolCalls(reply);
      if (toolCalls.length === 0) {
        finalReply = reply;
        break;
      }

      const cleanReply = stripToolCalls(reply);
      if (cleanReply) callbacks.onToken?.(cleanReply);
      messages.push({ role: 'assistant', content: reply });

      for (const tc of toolCalls) {
        if (controller.signal.aborted) {
          return { success: false, summary: '[cancelled|timeout]', tokenCount };
        }
        if (BLOCKED_TOOLS.has(tc.type)) {
          messages.push({
            role: 'user',
            content: `[RESULTADO]\nFerramenta "${tc.type}" bloqueada para subagentes.`,
          });
          continue;
        }

        callbacks.onToolStart?.(tc.type, tc.command.slice(0, 120));
        const result = await executeToolCall(tc.type, tc.command, cwd, {
          signal: controller.signal,
        });
        tokenCount += result.output.length;
        callbacks.onToolDone?.(tc.type, result.success);
        messages.push({
          role: 'user',
          content: `[RESULTADO]\n${result.output.slice(0, 4000)}`,
        });
      }
    }
  } finally {
    clearTimeout(timer);
    config.signal?.removeEventListener('abort', onParentAbort);
  }

  return {
    success: !!finalReply && !controller.signal.aborted,
    summary: controller.signal.aborted
      ? '[cancelled|timeout]'
      : finalReply || '(subagente sem resposta)',
    tokenCount,
  };
}

export interface SubagentHandle {
  id: string;
  goal: string;
  promise: Promise<SubagentResult>;
}

const registry: Map<string, SubagentHandle> = new Map();

export interface DelegateOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  permissionMode?: PermissionMode;
  onPermissionRequest?: SubagentConfig['onPermissionRequest'];
  id?: string;
}

export function delegateTask(
  goal: string,
  context: string,
  tools?: string[],
  callbacks?: SubagentCallbacks,
  options: DelegateOptions = {},
): string {
  const id =
    options.id || `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const promise = runSubagent(
    {
      goal,
      context,
      tools,
      cwd: options.cwd,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      permissionMode: options.permissionMode,
      onPermissionRequest: options.onPermissionRequest,
    },
    callbacks ?? {},
  );
  const handle: SubagentHandle = { id, goal, promise };
  registry.set(id, handle);
  promise.finally(() => {
    // Keep briefly so waiters that race still find it; delete on next tick
    setTimeout(() => registry.delete(id), 0);
  });
  return id;
}

export async function waitForDelegation(id: string): Promise<SubagentResult | null> {
  const handle = registry.get(id);
  if (!handle) return null;
  return handle.promise;
}

export async function waitForMany(ids: string[]): Promise<(SubagentResult | null)[]> {
  return Promise.all(ids.map((id) => waitForDelegation(id)));
}

export function listActiveSubagents(): Array<{ id: string; goal: string }> {
  return [...registry.values()].map((h) => ({ id: h.id, goal: h.goal }));
}
