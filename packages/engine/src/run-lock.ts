import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

const MANIAC_DIR = process.env.MANIAC_DIR || path.join(os.homedir(), '.maniac');
const LOCK_FILE = path.join(MANIAC_DIR, 'run.lock');

export interface RunLock {
  runId: string;
  pid: number;
  token: string;
  acquiredAt: number;
  cwd: string;
}

function ensureDir(): void {
  if (!fs.existsSync(MANIAC_DIR)) fs.mkdirSync(MANIAC_DIR, { recursive: true });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireRunLock(cwd: string, runId: string): RunLock | null {
  ensureDir();
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const existing: RunLock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (existing.pid !== process.pid && isPidAlive(existing.pid)) {
        return null;
      }
    }
  } catch (e) {
    console.debug('[run-lock] acquireRunLock stale:', e);
  }
  const lock: RunLock = {
    runId,
    pid: process.pid,
    token: createHash('sha1').update(`${runId}:${process.pid}:${Date.now()}`).digest('hex').slice(0, 12),
    acquiredAt: Date.now(),
    cwd,
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
  return lock;
}

export function releaseRunLock(token?: string): void {
  try {
    if (!fs.existsSync(LOCK_FILE)) return;
    if (token) {
      const existing: RunLock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (existing.token !== token) return;
    }
  } catch (e) {
    console.debug('[run-lock] releaseRunLock:', e);
  }
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch (e) {
    console.debug('[run-lock] releaseRunLock unlink:', e);
  }
}

export function readRunLock(): RunLock | null {
  try {
    if (!fs.existsSync(LOCK_FILE)) return null;
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  } catch (e) {
    console.debug('[run-lock] readRunLock:', e);
    return null;
  }
}
