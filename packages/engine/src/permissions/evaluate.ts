import { TOOL_CATALOG } from '../tool-catalog';
import { loadGrants } from './store';
import {
  EDIT_TOOLS,
  READ_ONLY_TOOLS,
  classifyTool,
  isReadOnlyShell,
  modeImpliesPlan,
  type PermissionDecision,
  type PermissionEvalResult,
  type PermissionMode,
  type PermissionRule,
  type PermissionConfig,
} from './types';
import type { EngineMode } from '@maniac/types';

function matchPattern(pattern: string, value: string): boolean {
  const p = pattern.trim();
  if (!p || p === '*') return true;
  // Prefix with optional trailing *
  if (p.endsWith('*')) {
    const prefix = p.slice(0, -1);
    return value.startsWith(prefix);
  }
  // Simple glob: * anywhere
  if (p.includes('*')) {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(value);
  }
  return value === p || value.startsWith(p + ' ');
}

function ruleMatches(rule: PermissionRule, tool: string, args: string): boolean {
  const cls = classifyTool(tool);
  const toolFilter = (rule.tool || 'any').toLowerCase();
  if (toolFilter !== 'any' && toolFilter !== cls && toolFilter !== tool.toLowerCase()) {
    return false;
  }
  if (rule.pattern) {
    return matchPattern(rule.pattern, args) || matchPattern(rule.pattern, tool);
  }
  return true;
}

function catalogIsDanger(tool: string): boolean {
  const entry = TOOL_CATALOG.find((t) => t.name === tool);
  if (entry) return entry.danger;
  // MCP tools (`server/tool`) can run arbitrary side effects — always treat as danger.
  if (tool.includes('/')) return true;
  return !READ_ONLY_TOOLS.has(tool);
}

/**
 * Evaluate permission for a tool call.
 * Order: deny rules > ask rules > allow rules > remembered grants > auto-readonly > mode policy.
 */
export function evaluatePermission(
  tool: string,
  args: string,
  cfg: PermissionConfig,
  opts: { cwd: string; engineMode: EngineMode },
): PermissionEvalResult {
  const mode = cfg.mode;
  const rules = cfg.rules || [];

  // Plan mode: deny mutating tools
  if (modeImpliesPlan(opts.engineMode, mode)) {
    if (!READ_ONLY_TOOLS.has(tool) && !(tool === 'exec' && isReadOnlyShell(args))) {
      if (EDIT_TOOLS.has(tool) || catalogIsDanger(tool) || tool === 'exec') {
        return { decision: 'deny', reason: 'plan mode is read-only' };
      }
    }
  }

  let matchedAsk: PermissionRule | undefined;
  let matchedAllow: PermissionRule | undefined;

  for (const rule of rules) {
    if (!ruleMatches(rule, tool, args)) continue;
    if (rule.action === 'deny') {
      return { decision: 'deny', matchedRule: rule, reason: 'matched deny rule' };
    }
    if (rule.action === 'ask' && !matchedAsk) matchedAsk = rule;
    if (rule.action === 'allow' && !matchedAllow) matchedAllow = rule;
  }

  if (matchedAsk) {
    return { decision: 'ask', matchedRule: matchedAsk, reason: 'matched ask rule' };
  }
  if (matchedAllow) {
    return { decision: 'allow', matchedRule: matchedAllow, reason: 'matched allow rule' };
  }

  // Remembered grants — require a non-empty prefix so "always" never becomes global.
  const grants = loadGrants(opts.cwd);
  for (const g of grants) {
    if (g.tool !== '*' && g.tool !== tool) continue;
    if (!g.prefix || !g.prefix.trim()) continue;
    const prefix = g.prefix.trim();
    // Match whole-token prefix only (avoid `rm -rf /tmp` matching `/tmp/../home`).
    if (args === prefix || args.startsWith(prefix + ' ') || args.startsWith(prefix + '\n')) {
      return { decision: 'allow', reason: 'remembered grant' };
    }
  }

  // Built-in auto-approvals
  if (READ_ONLY_TOOLS.has(tool)) {
    return { decision: 'allow', reason: 'read-only tool' };
  }
  if (tool === 'exec' && isReadOnlyShell(args)) {
    return { decision: 'allow', reason: 'read-only shell command' };
  }

  // Mode policy
  return applyModePolicy(tool, args, mode);
}

function applyModePolicy(tool: string, args: string, mode: PermissionMode): PermissionEvalResult {
  switch (mode) {
    case 'bypassPermissions':
      return { decision: 'allow', reason: 'bypassPermissions mode' };
    case 'dontAsk':
      if (READ_ONLY_TOOLS.has(tool) || (tool === 'exec' && isReadOnlyShell(args))) {
        return { decision: 'allow', reason: 'dontAsk allows read-only' };
      }
      return { decision: 'deny', reason: 'dontAsk denies unapproved tools' };
    case 'acceptEdits':
      if (EDIT_TOOLS.has(tool)) {
        return { decision: 'allow', reason: 'acceptEdits mode' };
      }
      if (READ_ONLY_TOOLS.has(tool) || (tool === 'exec' && isReadOnlyShell(args))) {
        return { decision: 'allow', reason: 'read-only under acceptEdits' };
      }
      if (catalogIsDanger(tool) || tool === 'exec') {
        return { decision: 'ask', reason: 'acceptEdits still prompts for shell/danger' };
      }
      return { decision: 'allow', reason: 'acceptEdits non-danger' };
    case 'plan':
      return { decision: 'deny', reason: 'plan mode' };
    case 'default':
    default:
      if (catalogIsDanger(tool) || tool === 'exec') {
        return { decision: 'ask', reason: 'default prompts for dangerous tools' };
      }
      return { decision: 'allow', reason: 'default allows non-danger' };
  }
}

export function decisionToUserMessage(decision: PermissionDecision, tool: string): string {
  if (decision === 'deny') return `Permission denied for tool: ${tool}`;
  return '';
}
