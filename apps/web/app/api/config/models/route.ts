import { NextRequest } from 'next/server';
import { loadManiacConfig, PROVIDER_DEFS, fetchModels } from '@maniac/engine';

/** GET /api/config/models?provider=X&baseUrl=Y — fetch available models for a provider */
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider');
  const baseUrl = req.nextUrl.searchParams.get('baseUrl') || undefined;

  if (!provider) {
    return Response.json({ models: [], error: 'provider query param required' }, { status: 400 });
  }

  const def = PROVIDER_DEFS.find((d) => d.id === provider);
  if (!def) {
    return Response.json({ models: [], error: `unknown provider: ${provider}` }, { status: 400 });
  }

  const cfg = loadManiacConfig();
  const envKey = `${provider.toUpperCase()}_API_KEY`;
  const apiKey =
    provider === 'auto' || provider === 'ollama'
      ? ''
      : cfg?.provider === provider
        ? cfg.apiKey
        : process.env[envKey] || '';

  try {
    const models = await fetchModels(def, apiKey, baseUrl);
    return Response.json({ models });
  } catch (e: any) {
    return Response.json({ models: [], error: e.message }, { status: 502 });
  }
}
