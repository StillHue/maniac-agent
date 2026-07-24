import { NextRequest } from 'next/server';
import {
  loadManiacConfig,
  saveManiacConfig,
  applyProviderSwitch,
  PROVIDER_DEFS,
  type ManiacConfig,
} from '@maniac/engine';

/** GET /api/config — return current config + available providers */
export async function GET() {
  const cfg = loadManiacConfig();
  const providers = PROVIDER_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    requiresKey: d.requiresKey,
    baseUrl: d.baseUrl,
  }));
  return Response.json({ config: cfg, providers });
}

/** POST /api/config — switch provider/model */
export async function POST(req: NextRequest) {
  try {
    const { provider, model, apiKey, baseUrl } = (await req.json()) as {
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    if (!provider) {
      return Response.json({ success: false, output: 'provider is required' }, { status: 400 });
    }

    // If apiKey/baseUrl provided, patch config directly
    if (apiKey || baseUrl) {
      const existing = loadManiacConfig();
      const resolvedModel = model || existing?.model || 'auto';
      const cfg: ManiacConfig = {
        provider,
        model: resolvedModel,
        apiKey: apiKey || existing?.apiKey || '',
        baseUrl: baseUrl || existing?.baseUrl,
        temperature: existing?.temperature ?? 0.3,
        maxTokens: existing?.maxTokens ?? 4096,
        autoSlots: existing?.autoSlots || [],
      };
      saveManiacConfig(cfg);
      try {
        const { setActiveProvider } = await import('@maniac/engine');
        setActiveProvider({ provider, model: resolvedModel });
      } catch {}
      return Response.json({ success: true, output: `Configurado: ${provider}/${resolvedModel}`, config: cfg });
    }

    const result = applyProviderSwitch(provider, model);
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ success: false, output: e.message }, { status: 500 });
  }
}
