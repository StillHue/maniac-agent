export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type GoalType = 'task' | 'deep search' | 'ask';

export interface ChatRequest {
  message: string;
  goal: GoalType;
  history?: ChatMessage[];
  timestamp?: number;
  clientVersion?: string;
}

export interface ChatResponse {
  response: string;
  route?: 'llama' | 'north' | 'nemotron';
}

export type EngineMode = 'chat' | 'ask' | 'plan';

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'dontAsk'
  | 'bypassPermissions'
  | 'plan';

export interface ToolCall {
  type: string;
  command: string;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
}

export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_start'; tool: string; args: string }
  | { type: 'tool_output'; tool: string; chunk: string }
  | { type: 'tool_result'; tool: string; success: boolean; output: string }
  | { type: 'subagent_start'; id: string; goal: string }
  | { type: 'subagents_dispatch'; count: number }
  | { type: 'subagent_token'; id: string; content: string }
  | { type: 'subagent_tool'; id: string; tool: string; done: boolean; success?: boolean }
  | { type: 'subagent_done'; id: string; success: boolean; summary: string }
  | { type: 'mode'; mode: EngineMode }
  | { type: 'permission_mode'; mode: PermissionMode }
  | { type: 'permission_request'; id: string; tool: string; args: string; reason?: string }
  | { type: 'permission_decision'; id: string; decision: 'allow' | 'deny' | 'always' }
  | { type: 'session'; sessionId: string }
  | { type: 'compact'; summary: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface EngineRequest {
  message: string;
  mode: EngineMode;
  history?: ChatMessage[];
  repoPath?: string;
}

export interface McpToolInfo {
  server: string;
  name: string;
  description?: string;
}
