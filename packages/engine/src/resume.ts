import { createHash } from 'crypto';
import type { ChatMessage, StreamEvent } from '@maniac/types';
import {
  checkResume,
  clearCheckpoint,
  clearCrashReport,
  loadCheckpoint,
  type CheckpointData,
  type CheckpointToolCall,
} from './immortality';
import { acquireRunLock, releaseRunLock } from './run-lock';
import { READ_ONLY_TOOLS } from './permissions/types';
import { executeToolCall } from './tools';
import { defaultHarness } from './harness';

const SAFE_RERUN = new Set<string>([
  ...READ_ONLY_TOOLS,
  'memory_read',
  'skill_view',
  'curator_status',
  'immortality_status',
  'server_status',
  'custom_tools_list',
  'telegram_list_chats',
]);

const NEVER_AUTOREPLAY = new Set([
  'self_restart',
  'server_start',
  'rebuild_engine',
  'send_telegram',
  'exec',
  'windows_exec',
  'write',
  'edit',
  'source_edit',
  'system_prompt_edit',
  'skill_create',
  'tool_create',
  'delegate',
  'http_request',
]);

export function toolFingerprint(type: string, args: string, index: number): string {
  return createHash('sha1').update(`${index}|${type}|${args}`).digest('hex').slice(0, 16);
}

export interface ResumeOutcome {
  resumed: boolean;
  soft: boolean;
  message: string;
  reply?: string;
}

export function tryDetectResume(): {
  shouldResume: boolean;
  checkpoint: CheckpointData | null;
  soft: boolean;
} {
  const data = checkResume();
  if (!data.shouldResume || !data.checkpoint) {
    return { shouldResume: false, checkpoint: null, soft: false };
  }
  return {
    shouldResume: true,
    checkpoint: data.checkpoint,
    soft: data.checkpoint.version < 2 || !data.checkpoint.toolBatch,
  };
}

/**
 * Resume from checkpoint.
 * - v1 / soft: restore context and ask the model to continue (no tool replay)
 * - v2: replay only safe pending read tools; mutating tools are marked skipped
 *   with a note unless `autoMutations` is true
 */
export async function resumeFromCheckpoint(
  cp: CheckpointData,
  opts: {
    onEvent?: (e: StreamEvent) => void;
    autoMutations?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<ResumeOutcome> {
  const cwd = cp.repoPath || cp.environment.cwd || process.cwd();
  const runId = cp.runId || `resume_${Date.now().toString(36)}`;
  const lock = acquireRunLock(cwd, runId);
  if (!lock) {
    return {
      resumed: false,
      soft: true,
      message: 'Another process holds the run lock — cannot resume.',
    };
  }

  const onEvent = opts.onEvent || (() => {});

  try {
    if (cp.version < 2 || !cp.toolBatch) {
      const note =
        '[SYSTEM] Recovered after crash (soft resume). Previous tool batch may have partially applied — verify before mutating.';
      const history = [
        ...cp.session.messages.filter((m) => m.role !== 'system'),
        { role: 'assistant' as const, content: cp.session.lastAssistantReply || '' },
        { role: 'user' as const, content: note },
      ];
      const reply = await defaultHarness.run({
        message: `Continue from where you left off. Last user request: ${cp.session.lastUserMessage}`,
        mode: cp.session.mode,
        history,
        repoPath: cwd,
        sessionId: cp.sessionId || undefined,
        signal: opts.signal,
        onEvent,
      });
      clearCrashReport();
      clearCheckpoint();
      return { resumed: true, soft: true, message: 'Soft resume completed', reply };
    }

    // Hard resume: inject completed tool results, auto-run safe pending, skip mutations
    const messages: ChatMessage[] = [...cp.session.messages];
    const calls = cp.toolBatch.calls;
    const pendingSafe: CheckpointToolCall[] = [];
    const pendingMutating: CheckpointToolCall[] = [];

    for (const call of calls) {
      if (call.status === 'done' && call.resultPreview) {
        messages.push({
          role: 'user',
          content: `[RESULTADO]\n${call.resultPreview}`,
        });
      } else if (call.status === 'pending' || call.status === 'failed') {
        if (SAFE_RERUN.has(call.type) && !NEVER_AUTOREPLAY.has(call.type)) {
          pendingSafe.push(call);
        } else {
          pendingMutating.push(call);
        }
      }
    }

    for (const call of pendingSafe) {
      if (opts.signal?.aborted) break;
      onEvent({ type: 'tool_start', tool: call.type, args: call.args });
      const result = await executeToolCall(call.type, call.args, cwd, { signal: opts.signal });
      onEvent({
        type: 'tool_result',
        tool: call.type,
        success: result.success,
        output: result.output,
      });
      messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
      call.status = result.success ? 'done' : 'failed';
      call.resultPreview = result.output.slice(0, 2000);
    }

    for (const call of pendingMutating) {
      if (opts.autoMutations) {
        onEvent({ type: 'tool_start', tool: call.type, args: call.args });
        const result = await executeToolCall(call.type, call.args, cwd, { signal: opts.signal });
        onEvent({
          type: 'tool_result',
          tool: call.type,
          success: result.success,
          output: result.output,
        });
        messages.push({ role: 'user', content: `[RESULTADO]\n${result.output}` });
        call.status = result.success ? 'done' : 'failed';
        call.resultPreview = result.output.slice(0, 2000);
      } else {
        const note = `[RESULTADO]\nSkipped after crash resume (mutating tool "${call.type}" requires confirmation). Re-issue if still needed.`;
        messages.push({ role: 'user', content: note });
        call.status = 'skipped';
        onEvent({ type: 'tool_result', tool: call.type, success: false, output: note });
      }
    }

    const reply = await defaultHarness.run({
      message: `You were interrupted by a crash. Pending mutating tools were skipped unless confirmed. Continue the task: ${cp.session.lastUserMessage}`,
      mode: cp.session.mode,
      history: messages.filter((m) => m.role !== 'system'),
      repoPath: cwd,
      sessionId: cp.sessionId || undefined,
      signal: opts.signal,
      onEvent,
    });

    clearCrashReport();
    clearCheckpoint();
    return {
      resumed: true,
      soft: false,
      message: `Hard resume: ${pendingSafe.length} safe tools replayed, ${pendingMutating.length} mutating skipped/confirmed`,
      reply,
    };
  } finally {
    releaseRunLock(lock.token);
  }
}

export async function tryAutoResume(opts: {
  onEvent?: (e: StreamEvent) => void;
  signal?: AbortSignal;
  enabled?: boolean;
}): Promise<ResumeOutcome | null> {
  if (opts.enabled === false) return null;
  const detected = tryDetectResume();
  if (!detected.shouldResume || !detected.checkpoint) return null;
  const cp = loadCheckpoint();
  if (!cp) return null;
  return resumeFromCheckpoint(cp, opts);
}
