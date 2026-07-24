import * as fs from 'fs';
import * as path from 'path';

/**
 * Vision routing: free code models (NVIDIA / OpenCode) can't read images,
 * so attached images are described by a vision model first and the
 * resulting text is injected back into the code model's prompt.
 */

const VISION_BASE_URL = process.env.MANIAC_VISION_BASE_URL || process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1';
const VISION_MODEL = process.env.MANIAC_VISION_MODEL || process.env.VISION_MODEL || 'mistral-small-latest';
// Mistral rejects base64 image payloads bigger than ~4MB
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME);

export function isImagePath(p: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase());
}

export function visionAvailable(): boolean {
  return !!(
    process.env.MANIAC_VISION_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.MISTRAL_API_KEY
  );
}

function resolveVisionKey(): string {
  const key =
    process.env.MANIAC_VISION_API_KEY ||
    process.env.MISTRAL_API_KEY ||
    process.env.GROQ_API_KEY ||
    '';
  if (!key) {
    throw new Error(
      'Vision routing requires an API key — set MANIAC_VISION_API_KEY, MISTRAL_API_KEY, or GROQ_API_KEY in .env',
    );
  }
  return key;
}

const DESCRIBE_PROMPT = `Voce eh um descritor de imagens para outro modelo de IA que NAO consegue ver imagens.
Descreva a imagem em detalhes exaustivos e objetivos, em portugues brasileiro:
- Se houver texto, codigo, logs ou mensagens de erro: TRANSCREVA tudo literalmente, preservando formatacao.
- Se for uma interface/screenshot: descreva layout, componentes, cores, estados e qualquer valor visivel.
- Se for um diagrama: descreva nos, conexoes e fluxo.
- Se for uma foto: descreva cena, objetos e contexto relevante.
Nao interprete nem responda a pergunta do usuario — apenas descreva o que a imagem contem.`;

export interface ImageDescription {
  path: string;
  description: string;
}

/** Sends one image to the vision model and returns a detailed description. */
export async function describeImage(imagePath: string, userText?: string): Promise<string> {
  const apiKey = resolveVisionKey();

  const stat = fs.statSync(imagePath);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 4MB): ${imagePath}`,
    );
  }

  const ext = path.extname(imagePath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error(`Unsupported image type "${ext}": ${imagePath}`);

  const b64 = fs.readFileSync(imagePath).toString('base64');
  const userContext = userText?.trim()
    ? `Contexto da pergunta do usuario (para voce saber o que priorizar na descricao): "${userText.trim()}"`
    : 'Descreva a imagem.';

  const res = await fetch(`${VISION_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0.2,
      max_tokens: 4096,
      // Hide chain-of-thought of reasoning models so content carries only
      // the final description.  Ignored by providers that don't support it.
      reasoning_format: 'hidden',
      messages: [
        { role: 'system', content: DESCRIBE_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userContext },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Vision model HTTP ${res.status}${err ? `: ${err.slice(0, 200)}` : ''}`);
  }

  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content || '';
  // Fallback for providers that still leak <think> blocks into content —
  // strip closed blocks, and if the model ran out of tokens mid-think
  // (unterminated tag), there is no usable description.
  let description = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (description.startsWith('<think>')) description = '';
  if (!description) throw new Error('Vision model returned an empty description');
  return description;
}

/** Describes every attached image; a failure on one image doesn't abort the rest. */
export async function describeImages(
  imagePaths: string[],
  userText?: string,
): Promise<ImageDescription[]> {
  const results: ImageDescription[] = [];
  for (const p of imagePaths) {
    try {
      results.push({ path: p, description: await describeImage(p, userText) });
    } catch (e: any) {
      results.push({ path: p, description: `[falha ao ler imagem: ${e.message}]` });
    }
  }
  return results;
}

/**
 * Injects vision descriptions into the user message so any text-only
 * code model can "see" the images. Placeholders like [image1] are kept —
 * the description block below maps them.
 */
export function buildVisionAugmentedMessage(
  message: string,
  descriptions: ImageDescription[],
): string {
  if (descriptions.length === 0) return message;
  const blocks = descriptions
    .map(
      (d, i) =>
        `[image${i + 1}] (${path.basename(d.path)}):\n${d.description}`,
    )
    .join('\n\n');
  return `${message}\n\n=== IMAGENS ANEXADAS (descritas pelo modelo de visao ${VISION_MODEL}) ===\nVoce nao ve as imagens diretamente; use as descricoes abaixo como se fossem as imagens.\n\n${blocks}\n=== FIM DAS IMAGENS ===`;
}

export function getVisionModelLabel(): string {
  return VISION_MODEL;
}
