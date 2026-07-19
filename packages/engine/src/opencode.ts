import { ChatMessage, StreamEvent } from '@maniac/types';
import * as path from 'path';
import { loadManiacConfig, PROVIDER_DEFS, AUTO_SLOTS, AutoRouterSlot } from './config';

try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') }); } catch {}

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
  model: 'big-pickle',
  temperature: 0.3,
  maxTokens: 4096,
};

const providerHistory: { task: string; provider: string; success: boolean }[] = [];

export function getActiveProvider(): ProviderConfig {
  return { ...activeProvider };
}

export function setActiveProvider(config: Partial<ProviderConfig>): void {
  activeProvider = { ...activeProvider, ...config };
}

export function getProviderHistory(): typeof providerHistory {
  return [...providerHistory];
}

// ─── OpenAI-compatible streaming call ────────────────────────────────────────

async function callOpenAICompat(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  opts: { apiKey: string; baseUrl: string; model: string; temperature: number; maxTokens: number },
): Promise<string> {
  const { apiKey, baseUrl, model, temperature, maxTokens } = opts;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const isStream = !!onEvent;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: isStream }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${err ? `: ${err.slice(0, 200)}` : ''}`);
  }

  if (!isStream || !res.body) {
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

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
        const token = parsed.choices?.[0]?.delta?.content || '';
        if (token) { fullText += token; onEvent!({ type: 'token', content: token }); }
      } catch {}
    }
  }
  return fullText.trim();
}

// ─── Gemini call ─────────────────────────────────────────────────────────────

async function callGemini(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  opts: { apiKey: string; model: string; temperature: number; maxTokens: number },
): Promise<string> {
  const { apiKey, model, temperature, maxTokens } = opts;
  const systemMsg = messages.find(m => m.role === 'system');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const body: any = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) },
  );

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  if (onEvent) onEvent({ type: 'token', content });
  return content;
}

// ─── Anthropic call ──────────────────────────────────────────────────────────

async function callAnthropic(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  opts: { apiKey: string; model: string; temperature: number; maxTokens: number },
): Promise<string> {
  const { apiKey, model, temperature, maxTokens } = opts;
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const filtered = messages.filter(m => m.role !== 'system');
  const body: any = { model, messages: filtered, max_tokens: maxTokens, temperature };
  if (systemMsg) body.system = systemMsg;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const content = data.content?.[0]?.text?.trim() || '';
  if (onEvent) onEvent({ type: 'token', content });
  return content;
}

// ─── Hermes (legacy local service) ───────────────────────────────────────────

async function callHermes(messages: ChatMessage[], onEvent?: (e: StreamEvent) => void): Promise<string> {
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
  return data.response || '';
}

// ─── Auto-router ─────────────────────────────────────────────────────────────
// Tries slots in priority order, falls over to the next on error.
// Refreshes env-var keys at call time (dotenv already loaded at module init).

function resolveSlots(overrides?: AutoRouterSlot[]): AutoRouterSlot[] {
  const slots = (overrides && overrides.length > 0 ? overrides : AUTO_SLOTS)
    .slice()
    .sort((a, b) => b.priority - a.priority);

  // Hydrate keys from env vars at call time so changes to .env are picked up
  return slots.map(s => ({
    ...s,
    apiKey: s.apiKey
      || (s.provider === 'nvidia'   ? process.env.NVIDIA_API_KEY   : '')
      || (s.provider === 'opencode' ? process.env.OPENCODE_API_KEY : '')
      || '',
  }));
}

async function callAutoRouter(
  messages: ChatMessage[],
  onEvent: ((e: StreamEvent) => void) | undefined,
  slotOverrides?: AutoRouterSlot[],
  temperature = 0.3,
  maxTokens = 4096,
): Promise<string> {
  const slots = resolveSlots(slotOverrides);
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
        apiKey: slot.apiKey, baseUrl, model: slot.model, temperature, maxTokens,
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
): Promise<string> {
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

  if (provider === 'auto') {
    return callAutoRouter(messages, onEvent, hydrated.autoSlots, temperature, maxTokens);
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
      model, temperature, maxTokens,
    });
  }
  if (provider === 'groq') {
    if (!apiKey && !GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    return callOpenAICompat(messages, onEvent, {
      apiKey: apiKey || GROQ_API_KEY,
      baseUrl: baseUrl || 'https://api.groq.com/openai/v1',
      model, temperature, maxTokens,
    });
  }
  if (provider === 'nvidia') {
    if (!apiKey && !NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY not set');
    return callOpenAICompat(messages, onEvent, {
      apiKey: apiKey || NVIDIA_API_KEY,
      baseUrl: baseUrl || NVIDIA_API_URL,
      model, temperature, maxTokens,
    });
  }

  const resolvedBase = baseUrl || def?.baseUrl || OPENCODE_API_URL.replace('/chat/completions', '');
  if (def?.requiresKey && !apiKey) {
    throw new Error(`API key not set for provider ${provider}`);
  }
  return callOpenAICompat(messages, onEvent, { apiKey, baseUrl: resolvedBase, model, temperature, maxTokens });
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
): Promise<string> {
  const detected = inferProviderFromMessage(messages);
  try {
    const result = await routeCall(messages, onEvent, detected?.provider, detected?.model);
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
): Promise<string> {
  return routeCall(messages, onEvent, config.provider, config.model);
}
