import Groq from 'groq-sdk';
import { ChatMessage } from '@maniac/types';

const groqApiKey = process.env.GROQ_API_KEY;
export const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;

const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || '';
const OPENCODE_API_URL = process.env.OPENCODE_API_URL || 'https://opencode.ai/zen/v1/chat/completions';

export async function callGroq(messages: ChatMessage[], model = 'llama-3.1-8b-instant'): Promise<string> {
  if (!groq) {
    throw new Error('Groq client not initialized. Please set GROQ_API_KEY.');
  }

  const response = await groq.chat.completions.create({
    model,
    messages: messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: m.content
    }))
  });

  return response.choices[0]?.message?.content || '';
}

export async function callNorthMini(messages: ChatMessage[], model = 'north-mini-code-free'): Promise<string> {
  if (!OPENCODE_API_KEY) {
    throw new Error('OPENCODE_API_KEY not set. Cannot call north-mini-code-free.');
  }

  const res = await fetch(OPENCODE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENCODE_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content: m.content
      })),
      temperature: 0.3,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenCode HTTP ${res.status}: ${err}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || '';
}
