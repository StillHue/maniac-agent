import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TelegramChatRecord {
  chatId: number;
  sessionId: string;
  cwd: string;
  title?: string;
  username?: string;
  updatedAt: number;
  lastMessageId?: number;
}

interface TelegramStore {
  offset: number;
  chats: Record<string, TelegramChatRecord>;
}

const STORE_PATH = path.join(os.homedir(), '.maniac', 'telegram', 'chats.json');

function ensureDir(): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadTelegramStore(): TelegramStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch {}
  return { offset: 0, chats: {} };
}

export function saveTelegramStore(store: TelegramStore): void {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getOrCreateChatSession(
  chatId: number,
  meta: { title?: string; username?: string },
  cwd: string,
  createSession: (cwd: string) => { id: string },
): TelegramChatRecord {
  const store = loadTelegramStore();
  const key = String(chatId);
  let rec = store.chats[key];
  if (!rec) {
    const session = createSession(cwd);
    rec = {
      chatId,
      sessionId: session.id,
      cwd,
      title: meta.title,
      username: meta.username,
      updatedAt: Date.now(),
    };
    store.chats[key] = rec;
    saveTelegramStore(store);
  } else {
    rec.updatedAt = Date.now();
    if (meta.title) rec.title = meta.title;
    if (meta.username) rec.username = meta.username;
    store.chats[key] = rec;
    saveTelegramStore(store);
  }
  return rec;
}

export function listKnownChats(): TelegramChatRecord[] {
  return Object.values(loadTelegramStore().chats).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getUpdateOffset(): number {
  return loadTelegramStore().offset || 0;
}

export function setUpdateOffset(offset: number): void {
  const store = loadTelegramStore();
  store.offset = offset;
  saveTelegramStore(store);
}

export function updateChatLastMessage(chatId: number, messageId: number): void {
  const store = loadTelegramStore();
  const rec = store.chats[String(chatId)];
  if (!rec) return;
  rec.lastMessageId = messageId;
  rec.updatedAt = Date.now();
  saveTelegramStore(store);
}
