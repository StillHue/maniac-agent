import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AutoRouterSlot {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** 0–100, higher = preferred when both are healthy */
  priority: number;
}

export interface ManiacConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** Populated when provider === 'auto' */
  autoSlots?: AutoRouterSlot[];
}

export interface ProviderDef {
  id: string;
  name: string;
  baseUrl: string;
  modelsEndpoint: string;
  chatEndpoint: string;
  authType: 'bearer' | 'query' | 'header' | 'none';
  authHeader?: string;
  extraHeaders?: Record<string, string>;
  requiresKey: boolean;
  format: 'openai' | 'gemini' | 'anthropic';
  modelsParser?: (data: any) => string[];
}

export const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).filter((id: string) => id.startsWith('gpt') || id.startsWith('o')).sort(),
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/messages',
    authType: 'header',
    authHeader: 'x-api-key',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    requiresKey: true,
    format: 'anthropic',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsEndpoint: '/models',
    chatEndpoint: '/models/{model}:generateContent',
    authType: 'query',
    requiresKey: true,
    format: 'gemini',
    modelsParser: (d) =>
      (d.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace('models/', ''))
        .sort(),
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (Array.isArray(d) ? d : d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434',
    modelsEndpoint: '/api/tags',
    chatEndpoint: '/v1/chat/completions',
    authType: 'none',
    requiresKey: false,
    format: 'openai',
    modelsParser: (d) => (d.models || []).map((m: any) => m.name).sort(),
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: false,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'auto',
    name: 'Auto (NVIDIA + OpenCode)',
    baseUrl: '',
    modelsEndpoint: '',
    chatEndpoint: '',
    authType: 'bearer',
    requiresKey: false,
    format: 'openai',
  },
];

const CONFIG_PATH = path.join(os.homedir(), '.maniac', 'config.json');

/** Default auto-router slots — NVIDIA primary, OpenCode secondary */
export const AUTO_SLOTS: AutoRouterSlot[] = [
  {
    provider: 'nvidia',
    model: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    apiKey: process.env.NVIDIA_API_KEY || '',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    priority: 90,
  },
  {
    provider: 'opencode',
    model: 'big-pickle',
    apiKey: process.env.OPENCODE_API_KEY || '',
    baseUrl: 'https://opencode.ai/zen/v1',
    priority: 70,
  },
];

export function loadManiacConfig(): ManiacConfig | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

export function saveManiacConfig(cfg: ManiacConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export async function fetchModels(def: ProviderDef, apiKey: string, customBaseUrl?: string): Promise<string[]> {
  const baseUrl = (customBaseUrl || def.baseUrl).replace(/\/$/, '');
  if (!baseUrl && def.id !== 'custom') throw new Error('Base URL required');
  if (!baseUrl) throw new Error('Provide the base URL for your custom endpoint');

  let url = `${baseUrl}${def.modelsEndpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(def.extraHeaders || {}),
  };

  if (def.authType === 'bearer' && apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (def.authType === 'header' && def.authHeader && apiKey) {
    headers[def.authHeader] = apiKey;
  } else if (def.authType === 'query' && apiKey) {
    url += `?key=${apiKey}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }

  const data = await res.json();

  if (def.modelsParser) return def.modelsParser(data);
  return (data.data || []).map((m: any) => m.id).filter(Boolean).sort();
}
