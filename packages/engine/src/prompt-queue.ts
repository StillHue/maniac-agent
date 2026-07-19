/**
 * Simple in-memory prompt queue.
 * Frontends enqueue messages while the engine is busy; drain when idle.
 */

export interface QueueEntry {
  id: string;
  text: string;
  enqueuedAt: number;
}

export class PromptQueue {
  private entries: QueueEntry[] = [];
  private seq = 0;

  enqueue(text: string): QueueEntry {
    const entry: QueueEntry = {
      id: `q_${Date.now().toString(36)}_${++this.seq}`,
      text,
      enqueuedAt: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  dequeue(): QueueEntry | undefined {
    return this.entries.shift();
  }

  peek(): QueueEntry | undefined {
    return this.entries[0];
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }

  list(): QueueEntry[] {
    return [...this.entries];
  }
}

export const globalPromptQueue = new PromptQueue();
