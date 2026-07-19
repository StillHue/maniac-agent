import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { EngineMode } from '@maniac/types';
import type { PermissionMode } from '@maniac/engine';

export const CONFIG_FILE = path.join(os.homedir(), '.maniac-cli.json');
export const HISTORY_FILE = path.join(os.homedir(), '.maniac-cli-history');

export interface CliConfig {
  mode: EngineMode;
  permissionMode: PermissionMode;
}

export function defaultConfig(): CliConfig {
  return { mode: 'chat', permissionMode: 'default' };
}

export function loadCliConfig(): CliConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch {}
  return defaultConfig();
}

export function saveCliConfig(c: CliConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
  } catch {}
}

export function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    }
  } catch {}
  return [];
}

export function appendHistory(line: string): void {
  try {
    fs.appendFileSync(HISTORY_FILE, line + '\n');
  } catch {}
}

export interface GitInfo {
  repo: string;
  branch: string;
}

export function getGitInfo(): GitInfo {
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const repo = path.basename(toplevel);
    const branch =
      execSync('git branch --show-current', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || 'HEAD';
    return { repo, branch };
  } catch {
    return { repo: 'maniac', branch: '' };
  }
}

export const MAX_TOKENS = 128000;

export function estimateTokens(msgs: { content: string }[]): number {
  return msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

export const ENGINE_MODES: EngineMode[] = ['chat', 'ask', 'plan'];
export const PERMISSION_MODES: PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
];

export function cycleEngineMode(current: EngineMode): EngineMode {
  const i = ENGINE_MODES.indexOf(current);
  return ENGINE_MODES[(i + 1) % ENGINE_MODES.length];
}

export function cyclePermissionMode(current: PermissionMode): PermissionMode {
  const i = PERMISSION_MODES.indexOf(current);
  return PERMISSION_MODES[(i + 1) % PERMISSION_MODES.length];
}
