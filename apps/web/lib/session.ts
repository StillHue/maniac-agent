import fs from 'fs';
import os from 'os';
import path from 'path';

const SESSION_FILE = path.join(os.homedir(), '.maniac-session.json');

interface SessionData {
  uuid: string;
  repo: string;
  workspace: string;
  createdAt: string;
}

export function saveSession(data: SessionData): void {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function getSession(): SessionData | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

export function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  } catch {}
}
