import {
  loadManiacConfig,
  saveManiacConfig,
  PROVIDER_DEFS,
  upsertRegisteredSlot,
  type ManiacConfig,
} from './config';

/** Env var that holds the API key for each provider id. */
export const PROVIDER_ENV_KEY: Record<string, string> = {
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

/** Sensible defaults when the user only names a provider. */
export const DEFAULT_MODELS: Record<string, string> = {
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  openrouter: 'openrouter/auto',
  mistral: 'mistral-large-latest',
  xai: 'grok-2-latest',
  together: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  nvidia: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  opencode: 'big-pickle',
  kilo: 'kilo-auto/free',
  cohere: 'command-r-plus',
  ollama: 'llama3.2',
  auto: 'auto',
  hermes: 'hermes',
  custom: 'custom',
  claude: 'grok-build-0.1',
};

const ALIASES: Record<string, string> = {
  groq: 'groq',
  openai: 'openai',
  gpt: 'openai',
  'gpt-4': 'openai',
  'gpt-4o': 'openai',
  anthropic: 'anthropic',
  claude: 'opencode',
  gemini: 'gemini',
  google: 'gemini',
  openrouter: 'openrouter',
  mistral: 'mistral',
  xai: 'xai',
  grok: 'xai',
  together: 'together',
  nvidia: 'nvidia',
  nemotron: 'nvidia',
  opencode: 'opencode',
  kilo: 'kilo',
  ollama: 'ollama',
  local: 'ollama',
  cohere: 'cohere',
  command: 'cohere',
  auto: 'auto',
  hermes: 'hermes',
  custom: 'custom',
};

export interface ProviderIntent {
  provider: string;
  model?: string;
}

/**
 * Detect NL switch intents: "use groq", "usar anthropic", "switch to openai",
 * "trocar para auto", optionally with "model X".
 */
export function parseProviderIntent(text: string): ProviderIntent | null {
  const lower = text.toLowerCase();
  const re =
    /(?:use|usar|switch\s+to|trocar\s+para|troca\s+para|mudar\s+para|mude\s+para)\s+([a-z0-9._/-]+)(?:\s+(?:model|modelo)\s+([a-z0-9._:/-]+))?/i;
  const m = lower.match(re);
  if (!m) return null;
  const raw = m[1].replace(/[.,!?;:]+$/, '');
  const provider = ALIASES[raw] || (PROVIDER_DEFS.some((d) => d.id === raw) ? raw : null);
  if (!provider) return null;
  return { provider, model: m[2] || undefined };
}

export function resolveProviderApiKey(provider: string, existing?: string): string {
  if (existing) return existing;
  const envVar = PROVIDER_ENV_KEY[provider];
  if (envVar && process.env[envVar]) return process.env[envVar]!;
  return '';
}

export function resolveProviderBaseUrl(provider: string, existing?: string): string {
  if (existing) return existing;
  if (provider === 'opencode') return 'https://opencode.ai/zen/v1';
  const def = PROVIDER_DEFS.find((d) => d.id === provider);
  return def?.baseUrl || '';
}

export interface ApplyProviderResult {
  success: boolean;
  output: string;
  config?: ManiacConfig;
}

/**
 * Persist a provider switch into ~/.maniac/config.json and sync in-memory
 * activeProvider. Hydrates the correct API key for the *target* provider.
 */
export function applyProviderSwitch(provider: string, model?: string): ApplyProviderResult {
  const known =
    PROVIDER_DEFS.some((d) => d.id === provider) ||
    provider === 'opencode' ||
    provider === 'hermes';
  if (!known) {
    return {
      success: false,
      output: `Unknown provider "${provider}". Supported: ${[
        ...PROVIDER_DEFS.map((d) => d.id),
        'opencode',
        'hermes',
      ].join(', ')}`,
    };
  }

  const existing = loadManiacConfig();
  const resolvedModel = model || DEFAULT_MODELS[provider] || existing?.model || 'auto';

  if (provider === 'custom') {
    const baseUrl = existing?.provider === 'custom' ? existing.baseUrl : undefined;
    if (!baseUrl) {
      return {
        success: false,
        output:
          'Provider "custom" requires a baseUrl. Configure it via /model first, then switch.',
      };
    }
  }

  const apiKey =
    provider === 'auto' || provider === 'ollama' || provider === 'hermes'
      ? ''
      : resolveProviderApiKey(
          provider,
          existing?.provider === provider ? existing.apiKey : undefined,
        );

  if (
    PROVIDER_ENV_KEY[provider] &&
    !apiKey &&
    provider !== 'auto' &&
    provider !== 'ollama' &&
    provider !== 'custom'
  ) {
    const envVar = PROVIDER_ENV_KEY[provider];
    return {
      success: false,
      output: `No API key for ${provider}. Set ${envVar} in .env or configure via /model.`,
    };
  }

  const baseUrl =
    provider === 'custom'
      ? existing?.baseUrl || ''
      : resolveProviderBaseUrl(
          provider,
          existing?.provider === provider ? existing?.baseUrl : undefined,
        );

  let autoSlots = existing?.autoSlots || [];
  if (provider === 'auto') {
    if (!autoSlots.length) {
      return {
        success: false,
        output:
          'Auto precisa de providers cadastrados. Use /model, escolha provider+modelo, depois ative Auto.',
      };
    }
  } else if (provider !== 'ollama' && provider !== 'hermes') {
    autoSlots = upsertRegisteredSlot(autoSlots, {
      provider,
      model: resolvedModel,
      apiKey,
      baseUrl: baseUrl || undefined,
    });
  }

  const cfg: ManiacConfig = {
    provider,
    model: resolvedModel,
    apiKey,
    baseUrl: baseUrl || undefined,
    temperature: existing?.temperature ?? 0.3,
    maxTokens: existing?.maxTokens ?? 4096,
    autoSlots,
  };

  saveManiacConfig(cfg);
  // Lazy require avoids circular import with opencode.ts
  try {
    const { setActiveProvider } = require('./opencode');
    setActiveProvider({ provider, model: resolvedModel });
  } catch (e) {
    console.debug('[provider-switch] Erro ao sincronizar activeProvider:', e);
  }
  return {
    success: true,
    output: `Modelo alterado: ${cfg.provider}/${cfg.model}`,
    config: cfg,
  };
}

/** Resolve credentials for a (possibly overridden) provider against current config. */
export function hydrateProviderCall(provider: string, model?: string): {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  autoSlots?: ManiacConfig['autoSlots'];
} {
  const cfg = loadManiacConfig();
  const resolvedModel = model || cfg?.model || DEFAULT_MODELS[provider] || 'auto';
  const apiKey = resolveProviderApiKey(
    provider,
    cfg?.provider === provider ? cfg.apiKey : undefined,
  );
  const baseUrl = resolveProviderBaseUrl(
    provider,
    cfg?.provider === provider ? cfg.baseUrl : undefined,
  );
  return {
    provider,
    model: resolvedModel,
    apiKey,
    baseUrl,
    temperature: cfg?.temperature ?? 0.3,
    maxTokens: cfg?.maxTokens ?? 4096,
    autoSlots: provider === 'auto' ? cfg?.autoSlots || [] : undefined,
  };
}
