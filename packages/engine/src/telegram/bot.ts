import type { StreamEvent } from '@maniac/types';
import { defaultHarness } from '../harness';
import { createSession, loadSession } from '../session';
import type { PermissionPromptDecision } from '../engine';
import { answerCallbackQuery, editMessageText, getUpdates, sendMessage } from './api';
import { isAllowlisted, loadAllowlist } from './allowlist';
import { TelegramProgress } from './progress';
import {
  getOrCreateChatSession,
  getUpdateOffset,
  setUpdateOffset,
} from './sessions';

interface PendingPermission {
  resolve: (d: PermissionPromptDecision) => void;
  chatId: number;
  messageId: number;
  expiresAt: number;
  requesterId?: number;
}

const pendingPermissions = new Map<string, PendingPermission>();
const activeRuns = new Map<number, AbortController>();

let stopping = false;

function stripToolMarkup(text: string): string {
  return text
    .replace(/\[TOOL:[\s\S]*?\[\/TOOL\]/gi, '')
    .replace(/\[RESULTADO\][\s\S]*?(?=\n\n|$)/gi, '')
    .trim();
}

async function handlePermissionRequest(
  chatId: number,
  req: { id: string; tool: string; args: string; reason?: string },
  requesterId?: number,
): Promise<PermissionPromptDecision> {
  const text =
    `Permission required\n\nTool: ${req.tool}\nArgs: ${req.args.slice(0, 200)}\n` +
    (req.reason ? `Reason: ${req.reason}\n` : '') +
    `\nApprove or reject:`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Allow once', callback_data: `perm:${req.id}:allow` },
        { text: 'Always', callback_data: `perm:${req.id}:always` },
      ],
      [{ text: 'Reject', callback_data: `perm:${req.id}:deny` }],
    ],
  };
  const res = await sendMessage(chatId, text, {
    parse_mode: undefined,
    reply_markup: keyboard,
  });
  const messageId = res.result?.message_id || 0;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPermissions.delete(req.id);
      resolve('deny');
      if (messageId) {
        void editMessageText(chatId, messageId, 'Permission timed out — denied.', {
          parse_mode: undefined,
        });
      }
    }, 120000);

    pendingPermissions.set(req.id, {
      chatId,
      messageId,
      expiresAt: Date.now() + 120000,
      requesterId,
      resolve: (d) => {
        clearTimeout(timer);
        resolve(d);
      },
    });
  });
}

async function handleCallback(cb: any): Promise<void> {
  const from = cb.from;
  if (!isAllowlisted(from)) {
    await answerCallbackQuery(cb.id, 'Unauthorized');
    return;
  }
  const data: string = cb.data || '';
  const m = data.match(/^perm:([^:]+):(allow|always|deny)$/);
  if (!m) {
    await answerCallbackQuery(cb.id, 'Unknown action');
    return;
  }
  const [, id, decision] = m;
  const pending = pendingPermissions.get(id);
  if (!pending) {
    await answerCallbackQuery(cb.id, 'Expired');
    return;
  }
  const cbChatId = cb.message?.chat?.id;
  if (cbChatId !== undefined && cbChatId !== pending.chatId) {
    await answerCallbackQuery(cb.id, 'Wrong chat');
    return;
  }
  if (pending.requesterId !== undefined && from?.id !== pending.requesterId) {
    await answerCallbackQuery(cb.id, 'Only the requester can decide');
    return;
  }
  pendingPermissions.delete(id);
  pending.resolve(decision as PermissionPromptDecision);
  await answerCallbackQuery(cb.id, decision);
  if (pending.messageId) {
    await editMessageText(
      pending.chatId,
      pending.messageId,
      `Permission ${decision}.`,
      { parse_mode: undefined },
    );
  }
}

async function handleMessage(msg: any, cwd: string): Promise<void> {
  const chatId = msg.chat?.id;
  const from = msg.from;
  const text = (msg.text || '').trim();
  if (!chatId || !text) return;

  if (!isAllowlisted(from)) {
    await sendMessage(chatId, 'Unauthorized. Ask the bot owner to add your user id to TELEGRAM_ALLOWED_USER_IDS.', {
      parse_mode: undefined,
    });
    return;
  }

  // Cancel previous run for this chat
  activeRuns.get(chatId)?.abort();
  const controller = new AbortController();
  activeRuns.set(chatId, controller);

  const rec = getOrCreateChatSession(
    chatId,
    {
      title: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || msg.chat?.title,
      username: from?.username,
    },
    cwd,
    createSession,
  );

  const session = loadSession(cwd, rec.sessionId);
  const history = session?.messages || [];
  const progress = new TelegramProgress(chatId);
  await progress.ensureStatusMessage('Thinking…');

  let fullText = '';
  try {
    await defaultHarness.run({
      message: text,
      mode: 'chat',
      history,
      sessionId: rec.sessionId,
      repoPath: cwd,
      permissionMode: 'default',
      signal: controller.signal,
      onPermissionRequest: (req) => handlePermissionRequest(chatId, req, from?.id),
      onEvent: (event: StreamEvent) => {
        if (event.type === 'token') fullText += event.content;
        void progress.onEvent(event);
      },
    });
    const cleaned = stripToolMarkup(fullText) || '(no response)';
    await progress.flush(cleaned);
  } catch (e: any) {
    await progress.flush(`Error: ${e.message}`);
  } finally {
    if (activeRuns.get(chatId) === controller) activeRuns.delete(chatId);
  }
}

export interface TelegramBotOptions {
  cwd?: string;
  pollTimeout?: number;
}

export async function runTelegramBot(opts: TelegramBotOptions = {}): Promise<void> {
  const cwd = opts.cwd || process.env.MANIAC_TELEGRAM_CWD || process.cwd();
  const pollTimeout = opts.pollTimeout ?? Number(process.env.TELEGRAM_POLL_TIMEOUT || 25);
  const allow = loadAllowlist();
  if (!allow.allowAll && allow.userIds.size === 0 && allow.usernames.size === 0) {
    console.error(
      'Telegram bot refused to start: set TELEGRAM_ALLOWED_USER_IDS or TELEGRAM_ALLOWED_USERNAMES (or TELEGRAM_ALLOW_ALL=1 for open bots).',
    );
    process.exit(1);
  }

  stopping = false;
  console.log(`maniac telegram bot listening (cwd=${cwd})`);

  const onStop = () => {
    stopping = true;
    for (const c of activeRuns.values()) c.abort();
  };
  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);

  let offset = getUpdateOffset();
  while (!stopping) {
    try {
      const data = await getUpdates(offset || undefined, pollTimeout);
      if (!data.ok) {
        console.error('getUpdates failed:', data.description);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        setUpdateOffset(offset);
        if (update.callback_query) {
          await handleCallback(update.callback_query);
        } else if (update.message) {
          // Fire and forget per-chat; serialization is via AbortController map
          void handleMessage(update.message, cwd);
        }
      }
    } catch (e: any) {
      if (stopping) break;
      console.error('poll error:', e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  setUpdateOffset(offset);
  console.log('telegram bot stopped');
}

export function stopTelegramBot(): void {
  stopping = true;
  for (const c of activeRuns.values()) c.abort();
}
