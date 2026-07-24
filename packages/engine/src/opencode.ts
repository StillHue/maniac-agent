import { ChatMessage, StreamEvent } from '@maniac/types';
import * as path from 'path';
import { loadManiacConfig, PROVIDER_DEFS, getRegisteredAutoSlots, AutoRouterSlot } from './config';
import {
  buildOpenAITools,
  finalizeNativeToolCalls,
  type CompletionResult,
  type OpenAIFunctionTool,
} from './openai-tools';

export type { CompletionResult, NativeToolCall } from './openai-tools';

try {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const dotenv = require('dotenv') as { config: (opts: { path: string }) => void };
  // Prefer ~/.maniac/.env so a project cwd .env cannot shadow maniac secrets.
  // When installed globally (Cursor extension), process.cwd() may point to the
  // npm install dir — only consider it if it actually contains a package.json.
  const candidates = [
    path.join(os.homedir(), '.maniac', '.env'),
  ];
  const cwd = process.cwd();
  // Only add cwd/.env if cwd looks like a real project (has package.json)
  // or if we're not in the global npm install dir.
  const npmGlobal = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules');
  if (!cwd.startsWith(npmGlobal) || fs.existsSync(path.join(cwd, 'package.json'))) {
    candidates.push(path.join(cwd, '.env'));
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
} catch { /* dotenv optional */ }

/** Hard ceiling for a single LLM HTTP call (stream included). Slow free models need room. */
const LLM_FETCH_TIMEOUT_MS = 300_000;
const LLM_FETCH_RETRIES = 2;

function isTransientLlmError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  const name = String((err as any)?.name || '');
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /timeout|aborted|TimeoutError|ECONNRESET|ETIMEDOUT|fetch failed|HTTP 429|HTTP 5\d\d/i.test(msg)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchLlm(
  input: string | URL,
  init: RequestInit,
  label: string,
): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt <= LLM_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(input, {
        ...init,
        signal: init.signal || AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS),
      });
      // Retry rate-limit / gateway blips before throwing
      if ((res.status === 429 || res.status >= 500) && attempt < LLM_FETCH_RETRIES) {
        const wait = 1000 * (attempt + 1);
        console.debug(`[opencode] ${label} HTTP ${res.status}; retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      if (!isTransientLlmError(e) || attempt >= LLM_FETCH_RETRIES) throw e;
      const wait = 1000 * (attempt + 1);
      console.debug(`[opencode] ${label} transient error; retry in ${wait}ms:`, (e as Error)?.message || e);
      await sleep(wait);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// ─── Legacy env-var defaults (fallback when config.json absent) ────────────

const OPENCODE_API_KEY  = process.env.OPENCODE_API_KEY  || '';
const OPENCODE_API_URL  = process.env.OPENCODE_API_URL  || 'https://opencode.ai/zen/v1/chat/completions';
const GROQ_API_KEY      = process.env.GROQ_API_KEY      || '';
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY    || '';
const NVIDIA_API_KEY    = process.env.NVIDIA_API_KEY    || '';
const NVIDIA_API_URL    = 'https://integrate.api.nvidia.com/v1';
const HERMES_API_URL    = process.env.HERMES_API_URL || 'http://localhost:3001/api/chat';

type ProviderName = 'opencode' | 'hermes' | 'groq' | 'gemini' | 'nvidia' | 'auto' | string;

interface ProviderConfig {
  provider: ProviderName;
  model: string;
  temperature: number;
  maxTokens: number;
}

let activeProvider: ProviderConfig = {
  provider: 'opencode',
  model: 'grok-build-0.1',
  temperature: 0.3,
  maxTokens: 4096,
};

const providerHistory: { task: string; provider: string; success: boolean }[] = [];

/** True only for explicit tool protocols — not bare shell markdown fences. */
function hasExplicitToolProtocol(text: string): boolean {
  return (
    /\[TOOL:[\w\/]+\]/i.test(text) ||
    /<tool_call>/i.test(text) ||
    /```tool_call\b/i.test(text) ||
    /\{\s*"name"\s*:\s*"[\w\/]+"\s*,\s*"(?:parameters|arguments)"\s*:/i.test(text)
  );
}

export function getActiveProvider(): ProviderConfig {
  return { ...activeProvider };
}

export function setActiveProvider(config: Partial<ProviderConfig>): void {
  activeProvider = { ...activeProvider, ...config };
}

export function getProviderHistory(): typeof providerHistory {
  return [...providerHistory];
}

function emptyCompletion(content = ''): CompletionResult {
  return { content, toolCalls: [] };
}

function mergeToolCallDelta(
  pending: Map<number, { id: string; name: string; arguments: string }>,
  parts: any[],
): void {
  for (const part of parts) {
    const idx = typeof part.index === 'number' ? part.index : 0;
    const cur = pending.get(idx) || { id: '', name: '', arguments: '' };
    if (part.id) cur.id = String(part.id);
    if (part.function?.name) cur.name += String(part.function.name);
    if (typeof part.function?.arguments === 'string') cur.arguments += part.function.arguments;
    pending.set(idx, cur);
  }
}

function messageToolCallsToNative(msg: any): CompletionResult['toolCalls'] {
  const raw = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
  const pending = new Map<number, { id: string; name: string; arguments: string }>();
  raw.forEach((tc: any, i: number) => {
    pending.set(i, {
      id: String(tc.id || `call_${i}`),
      name: String(tc.function?.name || ''),
      arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
    });
  });
  return finalizeNativeToolCalls(pending);
}

// ─── OpenAI-compatible streaming call ────────────────────────────────────────

async function callOpenAICompat(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  opts: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    tools?: OpenAIFunctionTool[];
    allowTools?: boolean;
  },
): Promise<CompletionResult> {
  const { apiKey, baseUrl, model, temperature, maxTokens } = opts;
  const useTools = opts.allowTools !== false && (opts.tools?.length ?? 0) > 0;
  const tools = useTools ? opts.tools : undefined;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const isStream = !!onEvent;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: isStream,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetchLlm(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, `openai/${model}`);

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    const status = res.status;
    // Some free/gateway models reject tools — retry once without them.
    if (tools?.length && status >= 400 && status < 500) {
      console.debug(`[opencode] tools rejected (${status}); retrying without tools`);
      return callOpenAICompat(messages, onEvent, { ...opts, allowTools: false, tools: undefined });
    }
    throw new Error(`HTTP ${status}${err ? `: ${err.slice(0, 200)}` : ''}`);
  }

  // Non-stream: surface reasoning + optional provider duration once.
  if (!isStream || !res.body) {
    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    const reasoning =
      typeof msg.reasoning_content === 'string' ? msg.reasoning_content.trim() : '';
    const toolCalls = messageToolCallsToNative(msg);
    const text =
      content || (toolCalls.length === 0 && hasExplicitToolProtocol(reasoning) ? reasoning : '');
    if (reasoning && onEvent) {
      const durationMs = (() => {
        const candidates = [
          msg.reasoning_duration_ms,
          msg.thinking_time_ms,
          data?.usage?.reasoning_time_ms,
          data?.usage?.thinking_time_ms,
        ];
        for (const v of candidates) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
        }
        return undefined;
      })();
      onEvent({ type: 'reasoning', content: reasoning, durationMs });
    }
    return { content: text, toolCalls };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let reasoningText = '';
  const pendingTools = new Map<number, { id: string; name: string; arguments: string }>();
  const { stripThinking } = require('./tools') as typeof import('./tools');

  const pickDurationMs = (parsed: any): number | undefined => {
    const c0 = parsed?.choices?.[0];
    const candidates = [
      c0?.delta?.reasoning_duration_ms,
      c0?.delta?.thinking_time_ms,
      c0?.delta?.reasoning_time,
      c0?.message?.reasoning_duration_ms,
      c0?.message?.thinking_time_ms,
      parsed?.usage?.reasoning_time_ms,
      parsed?.usage?.thinking_time_ms,
      parsed?.usage?.completion_time_ms,
    ];
    for (const v of candidates) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
      if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) {
        const n = parseFloat(v);
        if (n > 0) return Math.round(n);
      }
    }
    return undefined;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const dur = pickDurationMs(parsed);
        if (dur != null) {
          if (onEvent) onEvent({ type: 'reasoning', content: '', durationMs: dur });
        }
        const delta = parsed.choices?.[0]?.delta || {};
        const reason =
          (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
          (typeof delta.reasoning === 'string' && delta.reasoning) ||
          '';
        if (reason) {
          reasoningText += reason;
          if (onEvent) onEvent({ type: 'reasoning', content: reason });
        }
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
          mergeToolCallDelta(pendingTools, delta.tool_calls);
        }
        const token = typeof delta.content === 'string' ? delta.content : '';
        if (token) {
          fullText += token;
          const visible = stripThinking(fullText);
          const prevVisible = stripThinking(fullText.slice(0, fullText.length - token.length));
          const visibleDelta = visible.startsWith(prevVisible)
            ? visible.slice(prevVisible.length)
            : visible;
          if (visibleDelta) onEvent!({ type: 'token', content: visibleDelta });
        }
      } catch (e) {
        console.debug('[opencode] Erro ao parsear streaming chunk:', e);
      }
    }
  }

  const toolCalls = finalizeNativeToolCalls(pendingTools);
  const content = fullText.trim();
  const reasoning = reasoningText.trim();
  const text =
    content || (toolCalls.length === 0 && hasExplicitToolProtocol(reasoning) ? reasoning : '');
  return { content: text, toolCalls };
}

// ─── Gemini call ─────────────────────────────────────────────────────────────

async function callGemini(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  opts: { apiKey: string; model: string; temperature: number; maxTokens: number },
): Promise<CompletionResult> {
  const { apiKey, model, temperature, maxTokens } = opts;
  const systemMsg = messages.find(m => m.role === 'system');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const body: any = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

  const res = await fetchLlm(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    `gemini/${model}`,
  );

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  if (onEvent) onEvent({ type: 'token', content });
  return emptyCompletion(content);
}

// ─── Anthropic call ──────────────────────────────────────────────────────────

async function callAnthropic(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  opts: { apiKey: string; model: string; temperature: number; maxTokens: number },
): Promise<CompletionResult> {
  const { apiKey, model, temperature, maxTokens } = opts;
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const filtered = messages.filter(m => m.role !== 'system');
  const body: any = { model, messages: filtered, max_tokens: maxTokens, temperature };
  if (systemMsg) body.system = systemMsg;

  const res = await fetchLlm('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  }, `anthropic/${model}`);

  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const content = data.content?.[0]?.text?.trim() || '';
  if (onEvent) onEvent({ type: 'token', content });
  return emptyCompletion(content);
}

// ─── Hermes (legacy local service) ───────────────────────────────────────────

async function callHermes(messages: ChatMessage[], onEvent?: (e: StreamEvent) => void): Promise<CompletionResult> {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) throw new Error('No user message found');
  const res = await fetch(HERMES_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: lastUser.content, history: messages.slice(0, -1).filter(m => m.role !== 'system') }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
  const data = await res.json();
  if (onEvent) onEvent({ type: 'token', content: data.response });
  return emptyCompletion(data.response || '');
}

// ─── Auto-router ─────────────────────────────────────────────────────────────
// Tries slots in priority order, falls over to the next on error.
// Refreshes env-var keys at call time (dotenv already loaded at module init).

function resolveSlots(overrides?: AutoRouterSlot[]): AutoRouterSlot[] {
  // Auto only routes models the user registered — never baked-in free lists.
  const slots = getRegisteredAutoSlots(overrides)
    .slice()
    .sort((a, b) => b.priority - a.priority);

  // Hydrate keys from env vars at call time so changes to .env are picked up
  return slots.map(s => ({
    ...s,
    apiKey: s.apiKey
      || (s.provider === 'nvidia'     ? process.env.NVIDIA_API_KEY       : '')
      || (s.provider === 'opencode'   ? process.env.OPENCODE_API_KEY     : '')
      || (s.provider === 'xai'        ? process.env.XAI_API_KEY          : '')
      || (s.provider === 'openrouter' ? process.env.OPENROUTER_API_KEY   : '')
      || (s.provider === 'kilo'       ? process.env.KILO_GATEWAY_API_KEY : '')
      || (s.provider === 'groq'       ? process.env.GROQ_API_KEY         : '')
      || (s.provider === 'gemini'     ? process.env.GEMINI_API_KEY       : '')
      || (s.provider === 'mistral'    ? process.env.MISTRAL_API_KEY      : '')
      || (s.provider === 'together'   ? process.env.TOGETHER_API_KEY     : '')
      || (s.provider === 'cohere'     ? process.env.COHERE_API_KEY       : '')
      || (s.provider === 'openai'     ? process.env.OPENAI_API_KEY       : '')
      || (s.provider === 'anthropic'  ? process.env.ANTHROPIC_API_KEY    : '')
      || '',
  }));
}

async function callAutoRouter(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  slotOverrides?: AutoRouterSlot[],
  temperature = 0.3,
  maxTokens = 4096,
  tools?: OpenAIFunctionTool[],
): Promise<CompletionResult> {
  const slots = resolveSlots(slotOverrides);
  if (slots.length === 0) {
    throw new Error(
      'Auto-router: nenhum provider cadastrado. Use /model, escolha um provider + modelo, e só então ative Auto.',
    );
  }
  const errors: string[] = [];

  for (const slot of slots) {
    if (!slot.apiKey) {
      errors.push(`${slot.provider}: no API key`);
      continue;
    }
    try {
      const def = PROVIDER_DEFS.find(d => d.id === slot.provider);
      const baseUrl = slot.baseUrl || def?.baseUrl || '';

      if (slot.provider === 'gemini' || def?.format === 'gemini') {
        return await callGemini(messages, onEvent, { apiKey: slot.apiKey, model: slot.model, temperature, maxTokens });
      }
      if (slot.provider === 'anthropic' || def?.format === 'anthropic') {
        return await callAnthropic(messages, onEvent, { apiKey: slot.apiKey, model: slot.model, temperature, maxTokens });
      }
      return await callOpenAICompat(messages, onEvent, {
        apiKey: slot.apiKey, baseUrl, model: slot.model, temperature, maxTokens, tools,
      });
    } catch (e: any) {
      errors.push(`${slot.provider}/${slot.model}: ${e.message}`);
    }
  }

  throw new Error(`Auto-router: all slots failed\n${errors.join('\n')}`);
}

// ─── Route based on config.json or env vars ──────────────────────────────────

async function routeCall(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  overrideProvider?: string,
  overrideModel?: string,
  tools?: OpenAIFunctionTool[],
): Promise<CompletionResult> {
  const { hydrateProviderCall } = require('./provider-switch') as typeof import('./provider-switch');
  const cfg = loadManiacConfig();

  const provider = overrideProvider || cfg?.provider || activeProvider.provider;
  const hydrated = hydrateProviderCall(provider, overrideModel || (overrideProvider ? undefined : cfg?.model));
  const model = hydrated.model;
  const apiKey = hydrated.apiKey;
  const baseUrl = hydrated.baseUrl;
  const temperature = hydrated.temperature;
  const maxTokens = hydrated.maxTokens;
  const def = PROVIDER_DEFS.find(d => d.id === provider);
  const openaiTools = tools ?? buildOpenAITools();

  if (provider === 'auto') {
    return callAutoRouter(messages, onEvent, hydrated.autoSlots, temperature, maxTokens, openaiTools);
  }
  if (provider === 'gemini' || def?.format === 'gemini') {
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    return callGemini(messages, onEvent, { apiKey, model, temperature, maxTokens });
  }
  if (provider === 'anthropic' || def?.format === 'anthropic') {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    return callAnthropic(messages, onEvent, { apiKey, model, temperature, maxTokens });
  }
  if (provider === 'hermes') {
    return callHermes(messages, onEvent);
  }
  if (provider === 'opencode') {
    return callOpenAICompat(messages, onEvent, {
      apiKey: apiKey || OPENCODE_API_KEY,
      baseUrl: baseUrl || OPENCODE_API_URL.replace('/chat/completions', ''),
      model, temperature, maxTokens, tools: openaiTools,
    });
  }
  if (provider === 'groq') {
    if (!apiKey && !GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    return callOpenAICompat(messages, onEvent, {
      apiKey: apiKey || GROQ_API_KEY,
      baseUrl: baseUrl || 'https://api.groq.com/openai/v1',
      model, temperature, maxTokens, tools: openaiTools,
    });
  }
  if (provider === 'nvidia') {
    if (!apiKey && !NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY not set');
    return callOpenAICompat(messages, onEvent, {
      apiKey: apiKey || NVIDIA_API_KEY,
      baseUrl: baseUrl || NVIDIA_API_URL,
      model, temperature, maxTokens, tools: openaiTools,
    });
  }

  const resolvedBase = baseUrl || def?.baseUrl || OPENCODE_API_URL.replace('/chat/completions', '');
  if (def?.requiresKey && !apiKey) {
    throw new Error(`API key not set for provider ${provider}`);
  }
  return callOpenAICompat(messages, onEvent, {
    apiKey, baseUrl: resolvedBase, model, temperature, maxTokens, tools: openaiTools,
  });
}

// ─── Provider inference from message text ────────────────────────────────────

function inferProviderFromMessage(messages: ChatMessage[]): { provider: string; model?: string } | undefined {
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last) return undefined;
  const { parseProviderIntent, applyProviderSwitch } = require('./provider-switch') as typeof import('./provider-switch');
  const intent = parseProviderIntent(last.content);
  if (!intent) return undefined;
  applyProviderSwitch(intent.provider, intent.model);
  return intent;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function callOpenCode(
  messages: ChatMessage[],
  onEvent?: (event: StreamEvent) => void,
  opts?: { tools?: OpenAIFunctionTool[]; allowedToolNames?: string[] },
): Promise<CompletionResult> {
  const detected = inferProviderFromMessage(messages);
  const tools =
    opts?.tools ??
    (opts?.allowedToolNames ? buildOpenAITools(opts.allowedToolNames) : buildOpenAITools());
  try {
    const result = await routeCall(messages, onEvent, detected?.provider, detected?.model, tools);
    providerHistory.push({
      task: messages[messages.length - 1]?.content?.slice(0, 100) || '',
      provider: detected?.provider || activeProvider.provider,
      success: true,
    });
    return result;
  } catch (e: any) {
    providerHistory.push({
      task: messages[messages.length - 1]?.content?.slice(0, 100) || '',
      provider: detected?.provider || activeProvider.provider,
      success: false,
    });
    throw e;
  }
}

export async function chatWithProvider(
  messages: ChatMessage[],
  config: Partial<ProviderConfig>,
  onEvent?: (event: StreamEvent) => void,
): Promise<CompletionResult> {
  return routeCall(messages, onEvent, config.provider, config.model);
}
