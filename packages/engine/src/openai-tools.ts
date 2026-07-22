/**
 * OpenAI-compatible function-tool schemas for Maniac tools.
 * Serializes native JSON arguments into the string form executeToolCall expects.
 */
import { TOOL_CATALOG } from './tool-catalog';

export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface NativeToolCall {
  id: string;
  type: string;
  command: string;
}

export interface CompletionResult {
  content: string;
  toolCalls: NativeToolCall[];
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    input: {
      type: 'string',
      description: 'Full arguments string in the format this Maniac tool expects',
    },
  },
  required: ['input'],
} as const;

/** Structured schemas for the most-used coding tools. */
const STRUCTURED: Record<string, Record<string, unknown>> = {
  ls: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (relative or absolute). Empty = cwd.' },
    },
  },
  read: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
      offset: { type: 'number', description: 'Optional start line (1-based)' },
      limit: { type: 'number', description: 'Optional max lines' },
    },
    required: ['path'],
  },
  write: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      content: { type: 'string', description: 'Full file contents' },
    },
    required: ['path', 'content'],
  },
  edit: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit' },
      old_text: { type: 'string', description: 'Exact text to find' },
      new_text: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  grep: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern' },
      path: { type: 'string', description: 'Optional path scope' },
    },
    required: ['pattern'],
  },
  glob: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern e.g. **/*.ts' },
      path: { type: 'string', description: 'Optional root path' },
    },
    required: ['pattern'],
  },
  exec: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
    },
    required: ['command'],
  },
  delegate: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Subagent objective' },
      context: { type: 'string', description: 'Background context for the subagent' },
      tools: {
        type: 'string',
        description: 'Comma-separated tool names: ls,read,write,edit,grep,glob,exec',
      },
    },
    required: ['goal'],
  },
  http_request: {
    type: 'object',
    properties: {
      method: { type: 'string', description: 'HTTP method' },
      url: { type: 'string', description: 'URL' },
      headers: { type: 'object', description: 'Optional headers object' },
      body: { type: 'string', description: 'Optional body' },
    },
    required: ['method', 'url'],
  },
  apply_patch: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Unified diff / patch payload' },
    },
    required: ['input'],
  },
};

export function buildOpenAITools(allowedNames?: string[]): OpenAIFunctionTool[] {
  const allow = allowedNames?.length
    ? new Set(allowedNames.map((n) => n.toLowerCase()))
    : null;

  return TOOL_CATALOG.filter((t) => !allow || allow.has(t.name.toLowerCase())).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: STRUCTURED[t.name] || { ...INPUT_SCHEMA },
    },
  }));
}

/**
 * Convert OpenAI function arguments JSON into the string executeToolCall expects.
 */
export function nativeArgsToCommand(toolName: string, argsJson: string): string {
  const name = toolName.toLowerCase();
  let args: Record<string, unknown> = {};
  const raw = (argsJson || '').trim();
  if (raw) {
    try {
      args = JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  if (typeof args.input === 'string' && Object.keys(args).length === 1) {
    return args.input;
  }

  switch (name) {
    case 'ls':
      return String(args.path ?? args.input ?? '');
    case 'read': {
      const path = String(args.path ?? '');
      const offset = args.offset != null ? String(args.offset) : '';
      const limit = args.limit != null ? String(args.limit) : '';
      return [path, offset, limit].filter((p) => p !== '').join(' ');
    }
    case 'write':
      return `${String(args.path ?? '')}\n${String(args.content ?? '')}`;
    case 'edit':
      return `${String(args.path ?? '')}\n---\n${String(args.old_text ?? '')}\n---\n${String(args.new_text ?? '')}`;
    case 'grep':
      return [String(args.pattern ?? ''), args.path != null ? String(args.path) : '']
        .filter(Boolean)
        .join(' ');
    case 'glob':
      return [String(args.pattern ?? ''), args.path != null ? String(args.path) : '']
        .filter(Boolean)
        .join(' ');
    case 'exec':
      return String(args.command ?? args.input ?? '');
    case 'delegate': {
      const goal = String(args.goal ?? '');
      const context = String(args.context ?? '');
      const tools = String(args.tools ?? 'ls,read,glob,exec');
      return `${goal}|${context}|${tools}`;
    }
    case 'http_request':
      return JSON.stringify(args);
    case 'apply_patch':
      return String(args.input ?? args.patch ?? JSON.stringify(args));
    default:
      if (typeof args.input === 'string') return args.input;
      if (typeof args.command === 'string') return args.command;
      return raw || JSON.stringify(args);
  }
}

export function finalizeNativeToolCalls(
  pending: Map<number, { id: string; name: string; arguments: string }>,
): NativeToolCall[] {
  const calls: NativeToolCall[] = [];
  const indices = [...pending.keys()].sort((a, b) => a - b);
  for (const i of indices) {
    const p = pending.get(i)!;
    const type = (p.name || '').toLowerCase();
    if (!type) continue;
    calls.push({
      id: p.id || `call_${i}`,
      type,
      command: nativeArgsToCommand(type, p.arguments),
    });
  }
  return calls;
}

/** Prefer native tool_calls; fall back to text [TOOL:] parsing. */
export function resolveToolCallsFromCompletion(
  result: CompletionResult,
  parseText: (text: string, opts?: { recoverShellFences?: boolean }) => { type: string; command: string }[],
  opts?: { recoverShellFences?: boolean },
): { type: string; command: string }[] {
  if (result.toolCalls.length > 0) {
    return result.toolCalls.map((tc) => ({ type: tc.type, command: tc.command }));
  }
  return parseText(result.content, opts);
}
