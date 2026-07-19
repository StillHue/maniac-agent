import { ChatMessage } from '@maniac/types';

const TOKEN_ESTIMATE_RATIO = 4;
const COMPRESSION_THRESHOLD = 0.50;
const PROTECT_FIRST_N = 3;
const PROTECT_LAST_N = 10;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_ESTIMATE_RATIO);
}

export function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function shouldCompress(messages: ChatMessage[], contextLimit: number): boolean {
  const tokens = totalTokens(messages);
  return tokens >= contextLimit * COMPRESSION_THRESHOLD;
}

export function compressMessages(
  messages: ChatMessage[],
  contextLimit: number
): ChatMessage[] {
  if (messages.length <= PROTECT_FIRST_N + PROTECT_LAST_N + 2) return messages;

  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  const head = nonSystem.slice(0, PROTECT_FIRST_N);
  const tail = nonSystem.slice(-PROTECT_LAST_N);
  const middle = nonSystem.slice(PROTECT_FIRST_N, -PROTECT_LAST_N);

  if (middle.length < 3) return messages;

  const userTurns = middle.filter(m => m.role === 'user').map(m => m.content);
  const asstTurns = middle.filter(m => m.role === 'assistant').map(m => m.content);

  const summaryParts: string[] = [];
  if (userTurns.length > 0) {
    summaryParts.push(`Usuário perguntou sobre: ${userTurns.slice(0, 5).map(t => t.slice(0, 80)).join('; ')}`);
  }
  if (asstTurns.length > 0) {
    summaryParts.push(`Maniac respondeu com: ${asstTurns.slice(0, 5).map(t => {
      const clean = t.replace(/\[TOOL:[\s\S]*?\[\/TOOL\]/g, '').slice(0, 100);
      return clean;
    }).join('; ')}`);
  }

  const toolsUsed = middle
    .filter(m => m.role === 'user' && m.content.startsWith('[RESULTADO'))
    .map(m => {
      const match = m.content.match(/\[RESULTADO\]/);
      return match ? 'tool-call' : '';
    })
    .filter(Boolean);

  if (toolsUsed.length > 0) {
    summaryParts.push(`Ferramentas executadas: ${toolsUsed.length} vezes`);
  }

  const compressed: ChatMessage = {
    role: 'system',
    content: `[CONTEXT COMPACTION — REFERENCE ONLY]
Esta é uma compilação de histórico antigo, não instruções ativas.
O contexto original foi compactado para economizar espaço.
A mensagem mais recente do usuário é a autoridade final.

Sumário dos turns intermediários (${middle.length} mensagens omitidas):
${summaryParts.join('\n')}
---`,
  };

  return [...systemMsgs, compressed, ...head, ...tail];
}
