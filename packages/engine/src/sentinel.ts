import * as path from 'path';
import type { ChatMessage, StreamEvent } from '@maniac/types';
import { chatWithProvider } from './opencode';
import { executeToolCall, parseToolCalls, stripToolCalls } from './tools';
import { isReadOnlyShell } from './permissions';

export const SENTINEL_MODEL = 'north-mini-code-free';
export const SENTINEL_PROVIDER = 'opencode';

export type SentinelScope = 'uncommitted' | 'branch';

const ALLOWED_TOOLS = new Set(['ls', 'read', 'grep', 'glob', 'exec']);
const MAX_ITERATIONS = 20;

/** Reject path traversal / absolute paths outside the review cwd. */
function pathOutsideRepo(target: string, cwd: string): string | null {
  if (!target || !target.trim()) return null;
  const root = path.resolve(cwd);
  const resolved = path.isAbsolute(target) ? path.resolve(target) : path.resolve(cwd, target);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return `path outside repo blocked: ${target}`;
  }
  return null;
}

/** Sentinel exec: single git read-only invocation — no pipes/redirects/output files. */
function sentinelExecDenied(command: string): string | null {
  const cmd = command.trim();
  if (!cmd) return 'empty exec';
  if (!/^git(\s|$)/i.test(cmd)) {
    return 'sentinel exec only allows git … (use ls/read/grep/glob for files)';
  }
  // Block shell metacharacters so `git status | type C:\secret` cannot slip through
  // isReadOnlyShell's per-segment checks.
  if (/[|;&>`\n]|\$\(|\$\{|>>|<<|>|</.test(cmd)) {
    return 'sentinel exec: no pipes, redirects, or shell chaining';
  }
  if (/\s--output(=|\s)/i.test(cmd)) {
    return 'sentinel exec: git --output denied';
  }
  if (!isReadOnlyShell(cmd)) {
    return 'exec denied: git command is not read-only';
  }
  return null;
}

function toolPathDenied(type: string, command: string, cwd: string): string | null {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (type === 'ls') {
    return pathOutsideRepo(parts[0] || '.', cwd);
  }
  if (type === 'read') {
    return pathOutsideRepo(command.trim().split('\n')[0] || '', cwd);
  }
  if (type === 'grep' || type === 'glob') {
    // pattern [path…] — jail optional path arg
    const searchPath = parts.slice(1).join(' ');
    if (searchPath) return pathOutsideRepo(searchPath, cwd);
    return null;
  }
  return null;
}

const SENTINEL_SYSTEM = `You are the **Sentinel** — same role as Cursor Bugbot (/review-bugbot): review code changes for critical bugs and security vulnerabilities, then report with severity. You do NOT implement fixes, refactor, commit, or approve deploy.

## Tools (read-only only)
Use [TOOL:name]args[/TOOL] with only: ls, read, grep, glob, exec.
- ls/read/grep/glob: paths must stay inside the repository cwd (no absolute host paths).
- exec: **git read-only only** (status, diff, log, show, branch, merge-base, symbolic-ref, …). Never write, edit, or cat files via shell.

## Workflow

### 1. Diff scope
| Diff | Meaning |
|------|---------|
| branch changes | Commits + staged + unstaged vs merge-base with default base (main/master/develop) |
| uncommitted changes | Working tree only (git diff + git diff --cached) |

Infer base branch via: git symbolic-ref refs/remotes/origin/HEAD or git branch -r.

### 2. Collect (required)
In the Full Repository Path cwd:
- git status
- git branch --show-current
Then for the Diff mode given in the user message, run the matching git diff commands.
If .cursor/BUGBOT.md exists, read it.
Read changed files and direct dependencies when needed to validate findings.

### 3. Audit priorities (order)
1. Secrets/credentials (.env committed, API keys, PII in logs)
2. Injection (SQL, XSS, command, path traversal, SSRF)
3. Authn/authz gaps / IDOR
4. Sensitive data exposure
5. Insecure config (CORS *, debug endpoints)
6. Critical logic bugs (race, null in critical path, silent catch on money/data)
7. eval / unsafe deserialization / obvious CVEs in the diff

### 4. Severity
| Level | Blocks deploy? |
|-------|----------------|
| CRITICAL | Yes — exploitable now, secret leak, auth bypass, data loss |
| HIGH | Yes — likely serious vuln or critical-path bug |
| MEDIUM | No |
| LOW | No |

### 5. Report format (exact)
No diff: "Nenhum diff encontrado para revisar."
No findings: "Bugbot found no bugs."
With findings — markdown table sorted by severity:

| Severity | Location (file:line) | Finding |
|----------|----------------------|---------|
| CRITICAL | path:line | What is wrong, why it matters, brief evidence — no fix code |

Be concise. No style/lint nitpicks. Portuguese or English OK; keep the "Bugbot found no bugs." string when empty.`;

export interface SentinelRunOptions {
  cwd?: string;
  scope: SentinelScope;
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

function buildUserPrompt(cwd: string, scope: SentinelScope): string {
  const diffLabel = scope === 'branch' ? 'branch changes' : 'uncommitted changes';
  return [
    `Full Repository Path: ${cwd}`,
    `Diff: ${diffLabel}`,
    'Custom Instructions: Foco em bloqueantes de produção (CRITICAL/HIGH). Report only — do not fix.',
    '',
    'Collect the diff with tools, audit it, then output the final Bugbot report.',
  ].join('\n');
}

/**
 * Isolated Bugbot/Sentinel review. Does not touch chat sessions or the active
 * conversation model — always uses OpenCode north-mini-code-free.
 */
export async function runSentinelReview(opts: SentinelRunOptions): Promise<string> {
  const cwd = opts.cwd || process.cwd();
  const { scope, onEvent, signal } = opts;

  onEvent({
    type: 'mode',
    mode: 'ask',
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: SENTINEL_SYSTEM },
    { role: 'user', content: buildUserPrompt(cwd, scope) },
  ];

  let finalReply = '';

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal?.aborted) {
      onEvent({ type: 'error', message: 'aborted by user' });
      onEvent({ type: 'done' });
      return finalReply || '[sentinel aborted]';
    }

    let reply = '';
    try {
      reply = await chatWithProvider(
        messages,
        { provider: SENTINEL_PROVIDER, model: SENTINEL_MODEL, temperature: 0.2, maxTokens: 4096 },
        onEvent,
      );
    } catch (e: any) {
      onEvent({ type: 'error', message: e.message || String(e) });
      onEvent({ type: 'done' });
      return finalReply || `Erro: ${e.message || e}`;
    }

    const toolCalls = parseToolCalls(reply); // no fence→exec recovery
    if (toolCalls.length === 0) {
      finalReply = stripToolCalls(reply) || reply.trim();
      if (!finalReply) {
        onEvent({
          type: 'error',
          message: 'sentinel returned an empty report (thinking-only)',
        });
      }
      break;
    }

    messages.push({ role: 'assistant', content: reply });

    for (const tc of toolCalls) {
      if (signal?.aborted) break;
      const type = tc.type.toLowerCase();

      if (!ALLOWED_TOOLS.has(type)) {
        const msg = `tool "${type}" blocked in sentinel (read-only allowlist)`;
        onEvent({ type: 'tool_start', tool: type, args: tc.command.slice(0, 120) });
        onEvent({ type: 'tool_result', tool: type, success: false, output: msg });
        messages.push({ role: 'user', content: `[RESULTADO]\n${msg}` });
        continue;
      }

      if (type === 'exec') {
        const denied = sentinelExecDenied(tc.command);
        if (denied) {
          onEvent({ type: 'tool_start', tool: type, args: tc.command.slice(0, 120) });
          onEvent({ type: 'tool_result', tool: type, success: false, output: denied });
          messages.push({ role: 'user', content: `[RESULTADO]\n${denied}` });
          continue;
        }
      } else {
        const denied = toolPathDenied(type, tc.command, cwd);
        if (denied) {
          onEvent({ type: 'tool_start', tool: type, args: tc.command.slice(0, 120) });
          onEvent({ type: 'tool_result', tool: type, success: false, output: denied });
          messages.push({ role: 'user', content: `[RESULTADO]\n${denied}` });
          continue;
        }
      }

      onEvent({ type: 'tool_start', tool: type, args: tc.command.slice(0, 200) });
      const result = await executeToolCall(type, tc.command, cwd, { signal });
      onEvent({
        type: 'tool_result',
        tool: type,
        success: result.success,
        output: result.output.slice(0, 8000),
      });
      messages.push({
        role: 'user',
        content: `[RESULTADO]\n${result.output.slice(0, 12000)}`,
      });
    }
  }

  if (!finalReply) {
    onEvent({
      type: 'error',
      message: 'sentinel finished without a report',
    });
  }
  onEvent({ type: 'done' });
  return finalReply;
}

export function parseSentinelArg(arg: string): SentinelScope | { error: string } {
  const a = arg.trim().toLowerCase();
  if (!a) return 'uncommitted';
  if (a === 'branch' || a === 'branches') return 'branch';
  if (a === 'uncommitted' || a === 'local' || a === 'diff') return 'uncommitted';
  return {
    error: 'usage: /sentinel [branch]  — default reviews uncommitted changes',
  };
}
