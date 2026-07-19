import type { EngineMode } from '@maniac/types';

/** Permission modes for the tool authorization pipeline. */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'dontAsk'
  | 'bypassPermissions'
  | 'plan';

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export type PermissionRuleAction = 'allow' | 'deny' | 'ask';

export type PermissionToolClass =
  | 'any'
  | 'bash'
  | 'edit'
  | 'read'
  | 'grep'
  | 'mcp'
  | 'other';

export interface PermissionRule {
  action: PermissionRuleAction;
  tool?: PermissionToolClass | string;
  /** Glob-ish prefix pattern matched against tool args (e.g. command string). */
  pattern?: string;
}

export interface PermissionConfig {
  mode: PermissionMode;
  rules: PermissionRule[];
}

export interface PermissionRequest {
  id: string;
  tool: string;
  args: string;
  reason?: string;
}

export interface PermissionEvalResult {
  decision: PermissionDecision;
  matchedRule?: PermissionRule;
  reason: string;
}

export interface PermissionGrant {
  /** Tool name or '*' */
  tool: string;
  /** Optional args prefix remembered for "always allow" */
  prefix?: string;
  createdAt: number;
}

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  mode: 'default',
  rules: [],
};

/** Tools treated as read-only — never prompt unless an ask/deny rule matches. */
export const READ_ONLY_TOOLS = new Set([
  'read',
  'ls',
  'glob',
  'grep',
  'memory_read',
  'skill_view',
  'custom_tools_list',
  'server_status',
  'immortality_status',
  'telegram_list_chats',
  'curator_status',
]);

/** File-edit tools auto-approved under acceptEdits mode. */
export const EDIT_TOOLS = new Set([
  'write',
  'edit',
  'source_edit',
  'system_prompt_edit',
]);

/** Shell-ish tools that need careful matching. */
export const BASH_TOOLS = new Set(['exec', 'spawn_terminal', 'windows_exec']);

/** Built-in read-only shell prefixes (word-boundary style).
 *  Intentionally excludes `find` (supports -delete / -exec) and any
 *  command that commonly opens write/redirect side channels. */
export const READ_ONLY_SHELL_PREFIXES = [
  'ls',
  'dir',
  'pwd',
  'cd',
  'cat',
  'type',
  'head',
  'tail',
  'wc',
  'date',
  'whoami',
  'hostname',
  'echo',
  'git status',
  'git branch',
  'git log',
  'git diff',
  'git show',
  'git rev-parse',
  'git ls-files',
  'rg ',
  'grep ',
  'cargo check',
];

/** Characters / constructs that make a shell command NOT read-only. */
const SHELL_MUTATION_MARKERS = /[><`]|\$\(|\$\{|>>|<<|\btee\b/i;

export function classifyTool(tool: string): PermissionToolClass {
  if (tool.includes('/')) return 'mcp';
  if (BASH_TOOLS.has(tool)) return 'bash';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  if (READ_ONLY_TOOLS.has(tool) || tool === 'grep' || tool === 'glob') {
    return tool === 'grep' || tool === 'glob' ? 'grep' : 'read';
  }
  return 'other';
}

export function isReadOnlyShell(command: string): boolean {
  const cmd = command.trim().toLowerCase();
  if (!cmd) return false;
  // Reject redirects, substitutions, backticks, tee — even on "safe" prefixes.
  if (SHELL_MUTATION_MARKERS.test(cmd)) return false;
  // Reject chains with writes (re-check each segment)
  if (/[;&|]/.test(cmd) && !isAllSegmentsReadOnly(cmd)) return false;
  return READ_ONLY_SHELL_PREFIXES.some((p) => {
    const prefix = p.trimEnd();
    return cmd === prefix || cmd.startsWith(prefix + ' ') || cmd.startsWith(prefix + '\t');
  });
}

function isAllSegmentsReadOnly(command: string): boolean {
  const segments = command.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
  return segments.every((seg) => {
    const pipeParts = seg.split('|').map((s) => s.trim());
    return pipeParts.every((p) => isReadOnlyShell(p));
  });
}

/** Engine modes that imply plan (read-only exploration). */
export function modeImpliesPlan(engineMode: EngineMode, permissionMode: PermissionMode): boolean {
  return engineMode === 'plan' || permissionMode === 'plan';
}
