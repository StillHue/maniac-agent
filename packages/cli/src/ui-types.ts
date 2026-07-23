export interface ToolCallView {
  tool: string;
  args: unknown;
  done: boolean;
  success?: boolean;
  output?: string;
}

export interface SubagentStatus {
  id: string;
  goal: string;
  done: boolean;
  success?: boolean;
  lastTool?: string;
  tokenSnippet: string;
}

export interface ThoughtEntry {
  id: number;
  text: string;
  /** Wall-clock thinking time from the provider, when reported. */
  durationMs?: number;
}

export type StaticItem =
  | { type: 'user'; id: number; text: string }
  | {
      type: 'assistant';
      id: number;
      text: string;
      tools: ToolCallView[];
      subagents?: SubagentStatus[];
      /** Chain-of-thought shown above the reply. */
      thought?: string;
      thoughtDurationMs?: number;
    }
  | {
      type: 'thought';
      id: number;
      text: string;
      durationMs?: number;
    }
  | { type: 'system'; id: number; text: string; variant: 'info' | 'error' | 'success' | 'warn' };

export interface PermissionPromptState {
  id: string;
  tool: string;
  args: string;
  reason?: string;
  selected: number;
}

export const PERMISSION_OPTIONS = [
  { key: 'allow', label: 'Allow once' },
  { key: 'always', label: 'Always allow this prefix' },
  { key: 'deny', label: 'Reject' },
] as const;
