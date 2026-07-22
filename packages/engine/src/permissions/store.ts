import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_PERMISSION_CONFIG,
  type PermissionConfig,
  type PermissionGrant,
  type PermissionMode,
  type PermissionRule,
} from './types';

const MANIAC_HOME = path.join(os.homedir(), '.maniac');
const CONFIG_PATH = path.join(MANIAC_HOME, 'permissions.json');
const GRANTS_DIR = path.join(MANIAC_HOME, 'grants');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadPermissionConfig(): PermissionConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return {
        mode: (raw.mode as PermissionMode) || 'default',
        rules: Array.isArray(raw.rules) ? (raw.rules as PermissionRule[]) : [],
      };
    }
  } catch (e) {
    console.debug('[permissions] loadPermissionConfig:', e);
  }
  return { mode: 'default', rules: [] };
}

export function savePermissionConfig(cfg: PermissionConfig): void {
  ensureDir(MANIAC_HOME);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function setPermissionMode(mode: PermissionMode): PermissionConfig {
  const cfg = loadPermissionConfig();
  cfg.mode = mode;
  savePermissionConfig(cfg);
  return cfg;
}

function projectKey(cwd: string): string {
  const normalized = path.resolve(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 120);
  return normalized || 'default';
}

function grantsPath(cwd: string): string {
  return path.join(GRANTS_DIR, `${projectKey(cwd)}.json`);
}

export function loadGrants(cwd: string): PermissionGrant[] {
  try {
    const p = grantsPath(cwd);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    }
  } catch (e) {
    console.debug('[permissions] loadGrants:', e);
  }
  return [];
}

export function saveGrants(cwd: string, grants: PermissionGrant[]): void {
  ensureDir(GRANTS_DIR);
  fs.writeFileSync(grantsPath(cwd), JSON.stringify(grants, null, 2));
}

export function addGrant(cwd: string, grant: Omit<PermissionGrant, 'createdAt'>): void {
  const grants = loadGrants(cwd);
  grants.push({ ...grant, createdAt: Date.now() });
  saveGrants(cwd, grants);
}

export function clearGrants(cwd: string): void {
  const p = grantsPath(cwd);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.debug('[permissions] clearGrants unlink:', e);
  }
}
