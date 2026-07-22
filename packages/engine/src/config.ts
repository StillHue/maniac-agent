import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

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
    id: 'opencode',
    name: 'OpenCode',
    baseUrl: 'https://opencode.ai/zen/v1',
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
    id: 'kilo',
    name: 'Kilo Gateway',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    authType: 'bearer',
    requiresKey: true,
    format: 'openai',
    modelsParser: (d) => (d.data || []).map((m: any) => m.id).sort(),
  },
  {
    id: 'auto',
    name: 'Auto (OpenCode Zen free)',
    baseUrl: '',
    modelsEndpoint: '',
    chatEndpoint: '',
    authType: 'bearer',
    requiresKey: false,
    format: 'openai',
  },
];

const CONFIG_PATH = path.join(os.homedir(), '.maniac', 'config.json');

// ─── API Key Encryption ────────────────────────────────────────────────────
// When MANIAC_MASTER_KEY is set, API keys are encrypted at rest using AES-256-GCM.
// Without a master key, keys are stored in plaintext (backwards compatible).

function getMasterKey(): Buffer | null {
  const key = process.env.MANIAC_MASTER_KEY;
  if (!key) return null;
  // Derive a 32-byte key from the master key using SHA-256
  return crypto.createHash('sha256').update(key, 'utf8').digest();
}

const ENC_PREFIX = '$enc$';

function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;
  const mk = getMasterKey();
  if (!mk) return plaintext; // No master key — store plaintext
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', mk, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${ENC_PREFIX}${iv.toString('hex')}.${authTag}.${encrypted}`;
}

function decryptField(field: string): string {
  if (!field.startsWith(ENC_PREFIX)) return field; // Not encrypted
  const mk = getMasterKey();
  if (!mk) {
    console.warn('[config] Campo criptografado encontrado, mas MANIAC_MASTER_KEY não está definida');
    return ''; // Never treat ciphertext as a usable API key
  }
  const payload = field.slice(ENC_PREFIX.length);
  const parts = payload.split('.');
  if (parts.length !== 3) {
    console.warn('[config] Formato de campo criptografado inválido');
    return field;
  }
  const [ivHex, authTagHex, encrypted] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', mk, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.warn('[config] Falha ao descriptografar campo (chave inválida?):', e);
    return ''; // Return empty so we don't use a bad key silently
  }
}

function encryptConfigKeys(cfg: ManiacConfig): ManiacConfig {
  if (!getMasterKey()) return cfg;
  return {
    ...cfg,
    apiKey: encryptField(cfg.apiKey),
    autoSlots: cfg.autoSlots?.map(s => ({
      ...s,
      apiKey: encryptField(s.apiKey),
    })),
  };
}

function decryptConfigKeys(cfg: ManiacConfig): ManiacConfig {
  return {
    ...cfg,
    apiKey: decryptField(cfg.apiKey),
    autoSlots: cfg.autoSlots?.map(s => ({
      ...s,
      apiKey: decryptField(s.apiKey),
    })),
  };
}

/**
 * Default auto-router slots — OpenCode Zen free models only.
 * Avoid openrouter/free / random free gateways: they can route to content-safety
 * classifiers that dump "User Safety: unsafe" instead of answering.
 * @see https://opencode.ai/docs/zen/
 */
export const AUTO_SLOTS: AutoRouterSlot[] = [
  {
    provider: 'opencode',
    model: 'big-pickle',
    apiKey: process.env.OPENCODE_API_KEY || '',
    baseUrl: 'https://opencode.ai/zen/v1',
    priority: 100,
  },
  {
    provider: 'opencode',
    model: 'north-mini-code-free',
    apiKey: process.env.OPENCODE_API_KEY || '',
    baseUrl: 'https://opencode.ai/zen/v1',
    priority: 95,
  },
  {
    provider: 'opencode',
    model: 'deepseek-v4-flash-free',
    apiKey: process.env.OPENCODE_API_KEY || '',
    baseUrl: 'https://opencode.ai/zen/v1',
    priority: 90,
  },
  {
    provider: 'opencode',
    model: 'mimo-v2.5-free',
    apiKey: process.env.OPENCODE_API_KEY || '',
    baseUrl: 'https://opencode.ai/zen/v1',
    priority: 85,
  },
  {
    provider: 'opencode',
    model: 'laguna-s-2.1-free',
    apiKey: process.env.OPENCODE_API_KEY || '',
    baseUrl: 'https://opencode.ai/zen/v1',
    priority: 80,
  },
  {
    provider: 'opencode',
    model: 'nemotron-3-ultra-free',
    apiKey: process.env.OPENCODE_API_KEY || '',
    baseUrl: 'https://opencode.ai/zen/v1',
    priority: 75,
  },
];

export function loadManiacConfig(): ManiacConfig | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      // Strip UTF-8 BOM — Windows editors / PowerShell `Set-Content -Encoding utf8`
      // often prepend U+FEFF, which JSON.parse rejects.
      const text = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
      const raw = JSON.parse(text);
      return decryptConfigKeys(raw);
    }
  } catch (e) {
    console.debug('[config] loadManiacConfig falhou:', e);
  }
  return null;
}

export function saveManiacConfig(cfg: ManiacConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const encrypted = encryptConfigKeys(cfg);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(encrypted, null, 2));
}

/** Maps a config provider id / auto slot provider to its required env var. */
const PROVIDER_ENV_KEY: Record<string, string> = {
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  together: 'TOGETHER_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  kilo: 'KILO_GATEWAY_API_KEY',
  cohere: 'COHERE_API_KEY',
};

/**
 * Returns the list of provider ids that have a usable API key available,
 * either via env var or via a saved config that carries a non-empty key.
 */
export function getConfiguredProviders(): string[] {
  const configured = new Set<string>();
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_KEY)) {
    if (process.env[envVar]) configured.add(provider);
  }
  const cfg = loadManiacConfig();
  if (cfg && cfg.apiKey) configured.add(cfg.provider);
  if (cfg?.provider === 'auto' && Array.isArray(cfg.autoSlots)) {
    for (const slot of cfg.autoSlots) {
      if (slot.apiKey) configured.add(slot.provider);
    }
  }
  return [...configured];
}

/**
 * True when there is at least one provider usable right now (env key present
 * or saved config with a key). When false, the agent will fail with a 401
 * on the first LLM call.
 */
export function hasUsableProvider(): boolean {
  if (getConfiguredProviders().length > 0) return true;
  const cfg = loadManiacConfig();
  if (cfg?.provider === 'ollama' || cfg?.provider === 'custom') return true;
  if (cfg?.provider === 'auto') {
    const slots = cfg.autoSlots && cfg.autoSlots.length > 0 ? cfg.autoSlots : AUTO_SLOTS;
    if (slots.some((s) => s.apiKey || process.env[PROVIDER_ENV_KEY[s.provider] || ''])) return true;
  }
  return false;
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
