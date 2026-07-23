import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const PKG_NAME = 'maniac-agent';
const REGISTRY_URL = `https://registry.npmjs.org/${PKG_NAME}/latest`;
const SKIP_FILE = path.join(os.homedir(), '.maniac', 'skipped-update.json');
const FETCH_TIMEOUT_MS = 2500;
/** Strict-ish semver — reject ANSI / path / shell metacharacters from registry. */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface UpdateInfo {
  current: string;
  latest: string;
}

function sanitizeVersion(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!SEMVER_RE.test(t) || t.length > 64) return null;
  return t;
}

function readJsonVersion(pkgPath: string): string | null {
  try {
    if (!fs.existsSync(pkgPath)) return null;
    return sanitizeVersion(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version);
  } catch {
    return null;
  }
}

/** Local CLI version — works for npm pack (same dir) and workspace dist (parent). */
export function getLocalVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(here, 'package.json'),
      path.join(here, '..', 'package.json'),
      path.join(here, '..', '..', 'package.json'),
    ];
    for (const p of candidates) {
      const v = readJsonVersion(p);
      if (v) return v;
    }
  } catch {
    /* fall through */
  }
  return '0.0.0';
}

/** Compare semver-ish strings. Returns true if `latest` is strictly newer. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function wasSkipped(latest: string): boolean {
  try {
    if (!fs.existsSync(SKIP_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(SKIP_FILE, 'utf8'));
    return data?.version === latest;
  } catch {
    return false;
  }
}

export function skipUpdate(latest: string): void {
  try {
    const dir = path.dirname(SKIP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SKIP_FILE, JSON.stringify({ version: latest, at: Date.now() }, null, 2));
  } catch {
    /* ignore */
  }
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return sanitizeVersion(data.version);
  } catch {
    return null;
  }
}

/**
 * Returns update info when npm has a newer version the user has not skipped.
 * Pass `force` to ignore skip (e.g. /update).
 */
export async function checkForUpdate(opts?: { force?: boolean }): Promise<UpdateInfo | null> {
  if (process.env.MANIAC_SKIP_UPDATE === '1') return null;
  const current = getLocalVersion();
  const latest = await fetchLatestVersion();
  if (!latest || !isNewerVersion(latest, current)) return null;
  if (!opts?.force && wasSkipped(latest)) return null;
  return { current, latest };
}

export type Installer = 'npm' | 'bun';

export function detectInstaller(): Installer {
  // Prefer the tool that already owns the global install.
  try {
    const bunGlobal = execSync('bun pm ls -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    });
    if (bunGlobal.includes(PKG_NAME)) return 'bun';
  } catch {
    /* not bun-global */
  }
  try {
    const root = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    }).trim();
    if (root && fs.existsSync(path.join(root, PKG_NAME))) return 'npm';
  } catch {
    /* fall through */
  }
  // argv path heuristic
  const entry = process.argv[1] || '';
  if (/[\\/]\.bun[\\/]/i.test(entry)) return 'bun';
  return 'npm';
}

export function updateCommand(installer: Installer, version?: string): string {
  const spec = version ? `${PKG_NAME}@${version}` : `${PKG_NAME}@latest`;
  return installer === 'bun' ? `bun add -g ${spec}` : `npm i -g ${spec}`;
}

export async function runUpdate(
  installer: Installer = detectInstaller(),
  version?: string,
): Promise<{ ok: boolean; output: string }> {
  const ver = version ? sanitizeVersion(version) : null;
  if (version && !ver) {
    return { ok: false, output: `invalid version: ${String(version).slice(0, 40)}` };
  }
  const spec = ver ? `${PKG_NAME}@${ver}` : `${PKG_NAME}@latest`;
  const cmd = installer === 'bun' ? 'bun' : 'npm';
  const args = installer === 'bun' ? ['add', '-g', spec] : ['i', '-g', spec];
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout || ''}${stderr || ''}`.trim() || 'ok' };
  } catch (e: any) {
    const out = `${e?.stdout || ''}${e?.stderr || e?.message || e}`.trim();
    return { ok: false, output: out.slice(0, 800) };
  }
}
