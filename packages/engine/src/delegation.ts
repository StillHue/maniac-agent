import { ChatMessage } from '@maniac/types';
import { callOpenCode } from './opencode';
import { executeToolCall, parseToolCalls, stripToolCalls } from './tools';

const MAX_CHILD_ITERATIONS = 20;
const BLOCKED_TOOLS = new Set(['delegate', 'memory_save', 'profile_save', 'brain/save', 'obsidian/vault_write']);

export interface SubagentConfig {
  goal: string;
  context: string;
  tools?: string[];
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
  const toolList = (config.tools || ['ls', 'read', 'write', 'edit', 'grep', 'glob', 'exec'])
    .filter(t => !BLOCKED_TOOLS.has(t));

  const systemPrompt = `You are a focused subagent of Maniac. You have one job: complete the task below.

Task: ${config.goal}

Context: ${config.context}

Available tools: ${toolList.map(t => `[TOOL:${t}]`).join(', ')}

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
  const cwd = process.cwd();

  for (let iter = 0; iter < MAX_CHILD_ITERATIONS; iter++) {
    let reply = '';
    try {
      reply = await callOpenCode(messages, (event) => {
        if (event.type === 'token') {
          callbacks.onToken?.(event.content);
        }
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
      if (BLOCKED_TOOLS.has(tc.type)) {
        messages.push({ role: 'user', content: `[RESULTADO]\nFerramenta "${tc.type}" bloqueada para subagentes.` });
        continue;
      }

      callbacks.onToolStart?.(tc.type, tc.command.slice(0, 120));

      const result = await executeToolCall(tc.type, tc.command, cwd);
      tokenCount += result.output.length;

      callbacks.onToolDone?.(tc.type, result.success);

      messages.push({
        role: 'user',
        content: `[RESULTADO]\n${result.output.slice(0, 4000)}`,
      });
    }
  }

  return {
    success: !!finalReply,
    summary: finalReply || '(subagente sem resposta)',
    tokenCount,
  };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export interface SubagentHandle {
  id: string;
  goal: string;
  promise: Promise<SubagentResult>;
}

const registry: Map<string, SubagentHandle> = new Map();

export function delegateTask(
  goal: string,
  context: string,
  tools?: string[],
  callbacks?: SubagentCallbacks,
): string {
  const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const promise = runSubagent({ goal, context, tools }, callbacks ?? {});
  const handle: SubagentHandle = { id, goal, promise };
  registry.set(id, handle);
  promise.finally(() => registry.delete(id));
  return id;
}

export async function waitForDelegation(id: string): Promise<SubagentResult | null> {
  const handle = registry.get(id);
  if (!handle) return null;
  return handle.promise;
}

export function listActiveSubagents(): Array<{ id: string; goal: string }> {
  return [...registry.values()].map(h => ({ id: h.id, goal: h.goal }));
}
