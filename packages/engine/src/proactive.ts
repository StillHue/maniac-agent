import * as fs from 'fs';
import * as path from 'path';
import { callOpenCode } from './opencode';
import { ChatMessage } from '@maniac/types';

const PROACTIVE_DIR = process.env.MANIAC_BRAIN_DIR
  ? path.join(process.env.MANIAC_BRAIN_DIR, '_Maniac')
  : path.join(process.env.HOME || process.env.USERPROFILE || '.', '.maniac', 'brain', '_Maniac');

const PROACTIVE_FILE = path.join(PROACTIVE_DIR, 'proactive.json');
const LAST_ACTIVITY_FILE = path.join(PROACTIVE_DIR, 'last_activity.txt');

export interface PendingMessage {
  id: string;
  text: string;
  createdAt: number;
  delivered: boolean;
}

function ensureDir(): void {
  if (!fs.existsSync(PROACTIVE_DIR)) fs.mkdirSync(PROACTIVE_DIR, { recursive: true });
}

export function touchLastActivity(): void {
  try {
    ensureDir();
    fs.writeFileSync(LAST_ACTIVITY_FILE, String(Date.now()), 'utf8');
  } catch {}
}

export function getLastActivity(): number {
  try {
    return parseInt(fs.readFileSync(LAST_ACTIVITY_FILE, 'utf8').trim(), 10) || Date.now();
  } catch {
    return Date.now();
  }
}

export function getInactiveMinutes(): number {
  return (Date.now() - getLastActivity()) / 60000;
}

export function enqueueProactiveMessage(text: string): PendingMessage {
  ensureDir();
  const pending = getPendingMessages();
  const msg: PendingMessage = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    createdAt: Date.now(),
    delivered: false,
  };
  pending.push(msg);
  fs.writeFileSync(PROACTIVE_FILE, JSON.stringify(pending, null, 2), 'utf8');
  return msg;
}

function getPendingMessages(): PendingMessage[] {
  try {
    if (fs.existsSync(PROACTIVE_FILE)) {
      return JSON.parse(fs.readFileSync(PROACTIVE_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

export function getUndeliveredMessages(): PendingMessage[] {
  return getPendingMessages().filter(m => !m.delivered);
}

export function markDelivered(ids: string[]): void {
  const all = getPendingMessages();
  for (const m of all) {
    if (ids.includes(m.id)) m.delivered = true;
  }
  fs.writeFileSync(PROACTIVE_FILE, JSON.stringify(all, null, 2), 'utf8');
}

export async function proactivePulse(): Promise<string | null> {
  const inactiveMin = getInactiveMinutes();
  if (inactiveMin < 30) return null;

  const recentMessages = getPendingMessages().slice(-3);
  const recentContext = recentMessages.length > 0
    ? `\nÚltimas mensagens proativas enviadas:\n${recentMessages.map(m => `- [${new Date(m.createdAt).toISOString()}] ${m.text.slice(0, 200)}`).join('\n')}`
    : '';

  const msgs: ChatMessage[] = [
    {
      role: 'system',
      content: `Você é o Maniac, um orquestrador de agentes de IA autônomo.

Este é um PULSO PROATIVO — você está verificando se tem algo relevante para dizer ao usuário.

Contexto:
- Inativo há ${Math.round(inactiveMin)} minutos
- Você pode enviar mensagens proativas quando tiver algo importante: insights, descobertas, alertas, sugestões${recentContext}

Regras:
- Se NÃO houver nada relevante, responda APENAS "∅"
- Se houver algo, responda com a mensagem direta que quer enviar
- Máximo 400 caracteres
- Seja relevante, não encha o saco
- Não invente desculpas para falar — só fale se tiver algo real`,
    },
    { role: 'user', content: 'Pulso proativo. Tem algo a dizer?' },
  ];

  try {
    const response = await callOpenCode(msgs);
    const trimmed = response?.trim() || '';
    if (trimmed === '∅' || trimmed === '') return null;
    enqueueProactiveMessage(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}
