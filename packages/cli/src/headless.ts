import {
  defaultHarness,
  type PermissionMode,
  type PermissionPromptDecision,
} from '@maniac/engine';
import type { ChatMessage, EngineMode, StreamEvent } from '@maniac/types';

export interface HeadlessOptions {
  prompt: string;
  mode?: EngineMode;
  permissionMode?: PermissionMode;
  history?: ChatMessage[];
  sessionId?: string;
  /** When true, auto-approve all permission asks (like --yolo / bypass). */
  yolo?: boolean;
  cwd?: string;
  /** Image paths routed through the Groq vision model before the code model runs. */
  images?: string[];
  /** Output format: 'ndjson' (default) or 'text' (plain text, final answer only). */
  outputFormat?: 'ndjson' | 'text';
}

/** Project StreamEvent → compact NDJSON lines for scripting/CI. */
export function projectNdjson(event: StreamEvent): Record<string, unknown> | null {
  switch (event.type) {
    case 'token':
      return { type: 'text', content: event.content };
    case 'reasoning':
      return { type: 'thought', content: event.content };
    case 'tool_start':
      return { type: 'tool_start', tool: event.tool, args: event.args };
    case 'tool_output':
      return { type: 'tool_output', tool: event.tool, chunk: event.chunk };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool: event.tool,
        success: event.success,
        output: event.output,
      };
    case 'permission_request':
      return {
        type: 'permission_request',
        id: event.id,
        tool: event.tool,
        args: event.args,
        reason: event.reason,
      };
    case 'permission_decision':
      return { type: 'permission_decision', id: event.id, decision: event.decision };
    case 'session':
      return { type: 'session', sessionId: event.sessionId };
    case 'error':
      return { type: 'error', message: event.message };
    case 'done':
      return { type: 'end' };
    case 'mode':
      return { type: 'mode', mode: event.mode };
    case 'permission_mode':
      return { type: 'permission_mode', mode: event.mode };
    case 'compact':
      return { type: 'compact', summary: event.summary };
    case 'subagents_dispatch':
      return { type: 'subagents_dispatch', count: event.count };
    case 'subagent_start':
      return { type: 'subagent_start', id: event.id, goal: event.goal };
    case 'subagent_done':
      return { type: 'subagent_done', id: event.id, success: event.success, summary: event.summary };
    default:
      return null;
  }
}

export async function runHeadless(opts: HeadlessOptions): Promise<string> {
  const permissionMode: PermissionMode = opts.yolo
    ? 'bypassPermissions'
    : opts.permissionMode || 'dontAsk';

  const format = opts.outputFormat || 'ndjson';

  return defaultHarness.run({
    message: opts.prompt,
    mode: opts.mode || 'chat',
    history: opts.history,
    images: opts.images,
    repoPath: opts.cwd || process.cwd(),
    permissionMode,
    sessionId: opts.sessionId,
    onPermissionRequest: async (): Promise<PermissionPromptDecision> => {
      if (opts.yolo) return 'allow';
      return 'deny';
    },
    onEvent: (event) => {
      if (format === 'text') {
        // Plain text mode: only emit the final answer
        if (event.type === 'token') {
          process.stdout.write(event.content);
        } else if (event.type === 'error') {
          process.stderr.write(`[error] ${event.message}\n`);
        }
      } else {
        // NDJSON mode (default): emit all events
        const line = projectNdjson(event);
        if (line) process.stdout.write(JSON.stringify(line) + '\n');
      }
    },
  });
}

export function parseCliArgs(argv: string[]): {
  headless: boolean;
  prompt?: string;
  yolo: boolean;
  resume?: string;
  continueLatest: boolean;
  help: boolean;
  images: string[];
  telegram: boolean;
  noAutoResume: boolean;
  outputFormat: 'ndjson' | 'text';
} {
  const args = argv.slice(2);
  let headless = false;
  let prompt: string | undefined;
  let yolo = false;
  let resume: string | undefined;
  let continueLatest = false;
  let help = false;
  let telegram = false;
  let noAutoResume = false;
  let outputFormat: 'ndjson' | 'text' = 'ndjson';
  const images: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-p' || a === '--print' || a === '--prompt') {
      headless = true;
      prompt = args[++i];
    } else if (a === '--yolo' || a === '--dangerously-skip-permissions') {
      yolo = true;
    } else if (a === '-r' || a === '--resume') {
      resume = args[++i] || '';
    } else if (a === '-c' || a === '--continue') {
      continueLatest = true;
    } else if (a === '-i' || a === '--image') {
      const p = args[++i];
      if (p) images.push(p);
    } else if (a === '--output-format') {
      const fmt = args[++i];
      if (fmt === 'text' || fmt === 'streaming-json' || fmt === 'ndjson') {
        outputFormat = fmt === 'text' ? 'text' : 'ndjson';
      }
    } else if (a === 'telegram' || a === '--telegram') {
      telegram = true;
    } else if (a === '--no-auto-resume') {
      noAutoResume = true;
    } else if (a === '-h' || a === '--help') {
      help = true;
    } else if (!a.startsWith('-') && !prompt) {
      // bare prompt implies headless when combined with -p already handled
    }
  }

  return { headless, prompt, yolo, resume, continueLatest, help, images, telegram, noAutoResume, outputFormat };
}
