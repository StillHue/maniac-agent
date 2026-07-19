import type { StreamEvent } from '@maniac/types';
import { editMessageText, sendMessage } from './api';
import { updateChatLastMessage } from './sessions';

export class TelegramProgress {
  private chatId: number;
  private messageId: number | null = null;
  private lastEdit = 0;
  private buffer = '';
  private tools: string[] = [];
  private minIntervalMs = 1200;

  constructor(chatId: number) {
    this.chatId = chatId;
  }

  async ensureStatusMessage(seed = '…'): Promise<void> {
    if (this.messageId) return;
    const res = await sendMessage(this.chatId, seed, { parse_mode: undefined });
    const mid = res.ok ? (res.result?.message_id as number | undefined) : undefined;
    if (typeof mid === 'number') {
      this.messageId = mid;
      updateChatLastMessage(this.chatId, mid);
    }
  }

  private compose(): string {
    const toolLines = this.tools.slice(-5).map((t) => `• ${t}`).join('\n');
    const text = this.buffer.trim().slice(-1500);
    const parts = [text || '_working…_', toolLines].filter(Boolean);
    return parts.join('\n\n').slice(0, 3500);
  }

  async onEvent(event: StreamEvent): Promise<void> {
    if (event.type === 'token') {
      this.buffer += event.content;
    } else if (event.type === 'tool_start') {
      this.tools.push(`${event.tool}`);
    } else if (event.type === 'tool_result') {
      const last = this.tools[this.tools.length - 1];
      if (last === event.tool) {
        this.tools[this.tools.length - 1] = `${event.tool} ${event.success ? '✓' : '✗'}`;
      }
    } else {
      return;
    }
    const now = Date.now();
    if (now - this.lastEdit < this.minIntervalMs) return;
    this.lastEdit = now;
    await this.flush();
  }

  async flush(finalText?: string): Promise<void> {
    await this.ensureStatusMessage();
    if (!this.messageId) return;
    const text = finalText ?? this.compose();
    try {
      await editMessageText(this.chatId, this.messageId, text, { parse_mode: undefined });
    } catch {
      // ignore edit failures (message too old, etc.)
    }
  }

  getMessageId(): number | null {
    return this.messageId;
  }
}
