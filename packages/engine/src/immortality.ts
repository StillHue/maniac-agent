/**
 * MANIAC Immortality System
 *
 * Permite que o Maniac sobreviva a crashes, retomando de onde parou
 * com memória da sessão anterior. Funciona em três camadas:
 *
 * 1. Checkpoint: salva estado da sessão antes de operações críticas
 * 2. Heartbeat: sinal periódico de "estou vivo" para monitores externos
 * 3. Crash Recovery: detecta morte inesperada e retoma automaticamente
 *
 * O estado é armazenado em ~/.maniac/ (acessível de CLI, EC2 e Telegram).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatMessage, EngineMode } from '@maniac/types';

// ─── Diretório compartilhado ───────────────────────────────────────────────

export const MANIAC_DIR = path.join(os.homedir(), '.maniac');
export const CHECKPOINT_FILE = path.join(MANIAC_DIR, 'checkpoint.json');
export const HEARTBEAT_FILE = path.join(MANIAC_DIR, 'heartbeat.json');
export const CRASH_FILE = path.join(MANIAC_DIR, 'crash.json');
export const DEATHNOTE_FILE = path.join(MANIAC_DIR, 'deathnote.md');

// ─── Tipos ─────────────────────────────────────────────────────────────────

export interface CheckpointToolCall {
  id: string;
  type: string;
  args: string;
  status: 'pending' | 'done' | 'skipped' | 'failed';
  resultPreview?: string;
}

export interface CheckpointData {
  version: number;
  timestamp: number;
  session: {
    messages: ChatMessage[];
    mode: EngineMode;
    lastUserMessage: string;
    lastAssistantReply: string;
    toolExecutionIndex: number;
    totalToolExecutions: number;
  };
  environment: {
    cwd: string;
    processId: number;
    hostname: string;
    lockToken?: string;
  };
  /** v2 fields */
  runId?: string;
  sessionId?: string | null;
  phase?: 'awaiting_llm' | 'executing_tools' | 'awaiting_permission' | 'completed';
  permissionMode?: string;
  repoPath?: string;
  toolBatch?: {
    assistantRaw: string;
    calls: CheckpointToolCall[];
    toolIter: number;
  };
}

export interface HeartbeatData {
  timestamp: number;
  processId: number;
  sessionId: string;
  status: 'running' | 'idle' | 'busy';
}

export interface CrashReport {
  timestamp: number;
  error: string;
  stack: string;
  lastHeartbeat: number;
  heartbeatAge: number;
  checkpointAge: number;
  sessionId: string;
}

export interface ImmortalityStatus {
  alive: boolean;
  heartbeatAge: number;
  hasCheckpoint: boolean;
  checkpointAge: number;
  sessionId: string;
  lastCrash: CrashReport | null;
  processId: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!fs.existsSync(MANIAC_DIR)) fs.mkdirSync(MANIAC_DIR, { recursive: true });
}

let _sessionId: string | null = null;
function getSessionId(): string {
  if (!_sessionId) {
    try {
      const existing = loadCheckpoint();
      if (existing) {
        _sessionId = existing.environment.processId + '-' + existing.timestamp;
      } else {
        _sessionId = `${process.pid}-${Date.now()}`;
      }
    } catch {
      _sessionId = `${process.pid}-${Date.now()}`;
    }
  }
  return _sessionId;
}

// ─── Checkpoint ────────────────────────────────────────────────────────────

export function saveCheckpoint(state: {
  messages: ChatMessage[];
  mode: EngineMode;
  lastUserMessage: string;
  lastAssistantReply: string;
  toolExecutionIndex: number;
  totalToolExecutions: number;
  runId?: string;
  sessionId?: string | null;
  phase?: CheckpointData['phase'];
  permissionMode?: string;
  repoPath?: string;
  toolBatch?: CheckpointData['toolBatch'];
  lockToken?: string;
}): void {
  try {
    ensureDir();
    const data: CheckpointData = {
      version: state.toolBatch ? 2 : 1,
      timestamp: Date.now(),
      session: {
        messages: state.messages.slice(-50),
        mode: state.mode,
        lastUserMessage: state.lastUserMessage,
        lastAssistantReply: state.lastAssistantReply,
        toolExecutionIndex: state.toolExecutionIndex,
        totalToolExecutions: state.totalToolExecutions,
      },
      environment: {
        cwd: state.repoPath || process.cwd(),
        processId: process.pid,
        hostname: os.hostname(),
        lockToken: state.lockToken,
      },
      runId: state.runId,
      sessionId: state.sessionId,
      phase: state.phase,
      permissionMode: state.permissionMode,
      repoPath: state.repoPath,
      toolBatch: state.toolBatch,
    };
    atomicWrite(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Immortality] Erro ao salvar checkpoint:', (e as Error).message);
  }
}

export function loadCheckpoint(): CheckpointData | null {
  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return null;
    const raw = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
    const data = JSON.parse(raw) as CheckpointData;
    if (data.version !== 1 && data.version !== 2) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearCheckpoint(): void {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
  } catch {}
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

export function heartbeat(status: HeartbeatData['status'] = 'running'): void {
  try {
    ensureDir();
    const data: HeartbeatData = {
      timestamp: Date.now(),
      processId: process.pid,
      sessionId: getSessionId(),
      status,
    };
    atomicWrite(HEARTBEAT_FILE, JSON.stringify(data));
  } catch {}
}

export function getHeartbeatAge(): number {
  try {
    if (!fs.existsSync(HEARTBEAT_FILE)) return -1;
    const raw = fs.readFileSync(HEARTBEAT_FILE, 'utf8');
    const data = JSON.parse(raw) as HeartbeatData;
    return Date.now() - data.timestamp;
  } catch {
    return -1;
  }
}

export function getHeartbeat(): HeartbeatData | null {
  try {
    if (!fs.existsSync(HEARTBEAT_FILE)) return null;
    return JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Crash Report ──────────────────────────────────────────────────────────

export function reportCrash(error: Error | string): CrashReport {
  ensureDir();
  const errMsg = typeof error === 'string' ? error : error.message;
  const stack = typeof error === 'string' ? '' : (error.stack || '');

  const hb = getHeartbeat();
  const cp = loadCheckpoint();

  const report: CrashReport = {
    timestamp: Date.now(),
    error: errMsg,
    stack,
    lastHeartbeat: hb?.timestamp || 0,
    heartbeatAge: hb ? Date.now() - hb.timestamp : -1,
    checkpointAge: cp ? Date.now() - cp.timestamp : -1,
    sessionId: hb?.sessionId || cp?.environment.processId + '-' + cp?.timestamp || 'unknown',
  };

  atomicWrite(CRASH_FILE, JSON.stringify(report, null, 2));

  const deathNote = `# ☠️ Death Note — ${new Date(report.timestamp).toISOString()}

**Erro:** ${report.error}
**Stack:** ${report.stack || '*nenhum*'}
**Último heartbeat:** ${report.lastHeartbeat ? new Date(report.lastHeartbeat).toISOString() : 'nunca'}
**Idade do heartbeat:** ${report.heartbeatAge}ms
**Idade do checkpoint:** ${report.checkpointAge}ms
**Session ID:** ${report.sessionId}
`;
  fs.writeFileSync(DEATHNOTE_FILE, deathNote, 'utf8');

  return report;
}

// ─── Recovery ───────────────────────────────────────────────────────────────

export interface ResumeData {
  shouldResume: boolean;
  checkpoint: CheckpointData | null;
  crashReport: CrashReport | null;
  wasCleanShutdown: boolean;
}

export function checkResume(): ResumeData {
  const cp = loadCheckpoint();
  const hb = getHeartbeat();
  const hbAge = getHeartbeatAge();
  const crashRaw = loadCrashReport();

  if (!cp) {
    return { shouldResume: false, checkpoint: null, crashReport: null, wasCleanShutdown: true };
  }

  if (hbAge > 0 && hbAge < 10000) {
    return { shouldResume: false, checkpoint: cp, crashReport: null, wasCleanShutdown: false };
  }

  if (crashRaw) {
    return { shouldResume: true, checkpoint: cp, crashReport: crashRaw, wasCleanShutdown: false };
  }

  if (Date.now() - cp.timestamp > 3600000) {
    clearCheckpoint();
    return { shouldResume: false, checkpoint: null, crashReport: null, wasCleanShutdown: false };
  }

  return { shouldResume: true, checkpoint: cp, crashReport: null, wasCleanShutdown: false };
}

export function loadCrashReport(): CrashReport | null {
  try {
    if (!fs.existsSync(CRASH_FILE)) return null;
    return JSON.parse(fs.readFileSync(CRASH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function clearCrashReport(): void {
  try {
    if (fs.existsSync(CRASH_FILE)) fs.unlinkSync(CRASH_FILE);
  } catch {}
}

// ─── Métricas de Imortalidade ──────────────────────────────────────────────

export function getImmortalityStatus(): ImmortalityStatus {
  const hbAge = getHeartbeatAge();
  const cp = loadCheckpoint();
  const crash = loadCrashReport();
  const hb = getHeartbeat();

  return {
    alive: hbAge >= 0 && hbAge < 30000,
    heartbeatAge: hbAge,
    hasCheckpoint: cp !== null,
    checkpointAge: cp ? Date.now() - cp.timestamp : -1,
    sessionId: hb?.sessionId || cp?.environment.processId + '-' + cp?.timestamp || 'unknown',
    lastCrash: crash,
    processId: process.pid,
  };
}

// ─── Utilitários ───────────────────────────────────────────────────────────

function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function cleanImmortalityState(): void {
  clearCheckpoint();
  clearCrashReport();
  try {
    if (fs.existsSync(HEARTBEAT_FILE)) fs.unlinkSync(HEARTBEAT_FILE);
  } catch {}
}

export function immortalitySummary(): string {
  const status = getImmortalityStatus();
  const lines: string[] = [
    '=== IMORTALIDADE ===',
    `Status: ${status.alive ? '✅ Vivo' : '☠️ Morto'}`,
    `Session ID: ${status.sessionId}`,
    `Heartbeat: ${status.heartbeatAge >= 0 ? (status.heartbeatAge / 1000).toFixed(1) + 's atrás' : 'nunca'}`,
    `Checkpoint: ${status.hasCheckpoint ? (status.checkpointAge / 1000).toFixed(1) + 's atrás' : 'nenhum'}`,
    `Último crash: ${status.lastCrash ? new Date(status.lastCrash.timestamp).toISOString() : 'nenhum'}`,
    `Processo: ${status.processId}`,
  ];
  return lines.join('\n');
}
