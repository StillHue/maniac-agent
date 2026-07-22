import { spawn, execSync } from 'child_process';
import * as path from 'path';
import type { ToolOutput } from './tools';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SandboxConfig {
  /** Maximum execution time in seconds (default: 30) */
  timeout: number;
  /** Maximum output size in bytes (default: 1MB) */
  maxOutputBytes: number;
  /** Working directory for sandboxed commands */
  cwd?: string;
}

export interface SandboxResult {
  success: boolean;
  output: string;
  exitCode: number | null;
  duration: number;
  truncated: boolean;
}

// ─── Default Config ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SandboxConfig = {
  timeout: 30,
  maxOutputBytes: 1024 * 1024, // 1MB
};

let currentConfig: SandboxConfig = { ...DEFAULT_CONFIG };

export function configureSandbox(config: Partial<SandboxConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

export function getSandboxConfig(): SandboxConfig {
  return { ...currentConfig };
}

// ─── Sandboxed Execution ───────────────────────────────────────────────────

/**
 * Execute a command in a sandboxed subprocess.
 * - Forces a timeout to prevent runaway processes
 * - Truncates output to maxOutputBytes
 * - Returns exit code and duration
 */
export function sandboxExec(command: string, cwd?: string): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const resolvedCwd = cwd || currentConfig.cwd || process.cwd();

    // Use PowerShell on Windows, else /bin/sh
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : '/bin/sh';
    const shellArgs = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

    const SAFE_ENV_KEYS = new Set([
      'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP',
      'SystemRoot', 'windir', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'NODE_PATH',
    ]);
    const safeEnv: Record<string, string> = {};
    for (const key of SAFE_ENV_KEYS) { if (process.env[key]) safeEnv[key] = process.env[key]!; }

    const child = spawn(shell, shellArgs, {
      cwd: resolvedCwd,
      env: safeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timeoutMs = currentConfig.timeout * 1000;
    let killed = false;
    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let stderrSize = 0;
    const maxBytes = currentConfig.maxOutputBytes;

    // Timeout timer
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      // On Windows, SIGTERM may not work for some processes
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 2000);
    }, timeoutMs);

    child.stdout!.on('data', (chunk: Buffer) => {
      if (killed) return;
      const remaining = maxBytes - stdoutSize;
      if (remaining <= 0) return;
      if (chunk.length <= remaining) {
        stdout += chunk.toString('utf8');
        stdoutSize += chunk.length;
      } else {
        stdout += chunk.slice(0, remaining).toString('utf8');
        stdoutSize = maxBytes;
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      if (killed) return;
      const remaining = maxBytes - stderrSize;
      if (remaining <= 0) return;
      if (chunk.length <= remaining) {
        stderr += chunk.toString('utf8');
        stderrSize += chunk.length;
      } else {
        stderr += chunk.slice(0, remaining).toString('utf8');
        stderrSize = maxBytes;
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const duration = Date.now() - start;

      let output = '';
      if (stdout) output += stdout;
      if (stderr) {
        if (output) output += '\n';
        output += stderr;
      }

      const truncated = stdoutSize >= maxBytes || stderrSize >= maxBytes;

      resolve({
        success: exitCode === 0 && !killed,
        output,
        exitCode,
        duration,
        truncated,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: `Sandbox error: ${err.message}`,
        exitCode: -1,
        duration: Date.now() - start,
        truncated: false,
      });
    });
  });
}

// ─── Tool Wrapper ──────────────────────────────────────────────────────────

/**
 * Wrap a tool execution to run in the sandbox with safety checks.
 */
export async function sandboxTool(
  toolName: string,
  args: string,
  cwd: string,
): Promise<ToolOutput> {
  const { TOOL_CATALOG } = require('./tool-catalog');
  const entry = TOOL_CATALOG.find((t: any) => t.name === toolName);
  const isDangerous = entry?.danger === true;

  if (toolName === 'exec') {
    const result = await sandboxExec(args, cwd);
    return {
      success: result.success,
      output: result.truncated
        ? result.output + `\n\n[output truncated at ${currentConfig.maxOutputBytes} bytes]`
        : result.output,
    };
  }

  // For non-exec tools, just add sandbox metadata
  const { executeToolCall } = require('./tools');
  const result: ToolOutput = await executeToolCall(toolName, args, cwd);

  if (isDangerous) {
    return {
      ...result,
      output: `[sandbox] Tool "${toolName}" executed\n\n${result.output}`,
    };
  }

  return result;
}

// ─── Sandbox Tool Interface ────────────────────────────────────────────────

export function handleSandboxTool(args: string): ToolOutput {
  const parts = args.trim().split(/\s+/);
  const action = parts[0] || 'status';

  switch (action) {
    case 'status':
      return {
        success: true,
        output: `Sandbox: timeout=${currentConfig.timeout}s, maxOutput=${(currentConfig.maxOutputBytes / 1024).toFixed(0)}KB`,
      };
    case 'config': {
      const configStr = args.trim().slice(6).trim();
      if (!configStr) {
        return {
          success: true,
          output: JSON.stringify(currentConfig, null, 2),
        };
      }
      try {
        const newConfig = JSON.parse(configStr);
        if (newConfig.timeout) currentConfig.timeout = newConfig.timeout;
        if (newConfig.maxOutputBytes) currentConfig.maxOutputBytes = newConfig.maxOutputBytes;
        if (newConfig.cwd) currentConfig.cwd = newConfig.cwd;
        return {
          success: true,
          output: `Sandbox config updated: ${JSON.stringify(currentConfig)}`,
        };
      } catch (e: any) {
        return { success: false, output: `JSON invalido: ${e.message}` };
      }
    }
    default:
      return { success: false, output: 'formato: sandbox status|config [json]' };
  }
}
