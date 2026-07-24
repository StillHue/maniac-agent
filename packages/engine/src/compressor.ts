import { ChatMessage } from '@maniac/types';

const TOKEN_ESTIMATE_RATIO = 4;
const COMPRESSION_THRESHOLD = 0.60;
const PROTECT_FIRST_N = 3;
const PROTECT_LAST_N = 12;

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

/**
 * Extrai informacoes semanticas de mensagens intermediarias para preservar
 * contexto apos compressao. Melhor que jogar tudo fora.
 */
function extractSemanticSummary(middle: ChatMessage[]): string[] {
  const facts: string[] = [];

  for (const msg of middle) {
    const content = msg.content;

    // Extrai resultados de ferramentas importantes (erros, escrita, edicao)
    if (content.startsWith('[RESULTADO]') || content.startsWith('[RESULTADO MCP')) {
      // Ferramentas que alteraram estado
      if (/write|edit|source_edit|exec|rebuild|create|delete|remove/i.test(content)) {
        const firstLine = content.split('\n')[0].slice(0, 120);
        facts.push(`[mutacao] ${firstLine}`);
      }
      // Erros
      if (/error|fail|erro|falh/i.test(content)) {
        const snippet = content.split('\n').slice(0, 2).join('; ').slice(0, 150);
        facts.push(`[falha] ${snippet}`);
      }
    }

    // Extrai decisoes e conclusoes do assistente
    if (msg.role === 'assistant') {
      const clean = content
        .replace(/\[TOOL:[\s\S]*?\[\/TOOL\]/g, '')
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .trim();

      // Decisoes (linhas com "feito", "alterado", "criado", "corrigido")
      const decisionLines = clean
        .split('\n')
        .filter(l =>
          /(feito|pronto|alterad[ao]|criad[ao]|corrigid[ao]|implementad[ao]|resolvid[ao]|concluído)/i.test(l)
        )
        .map(l => l.trim().slice(0, 120));

      if (decisionLines.length > 0) {
        facts.push(`[decisao] ${decisionLines.join(' | ')}`);
      }
    }
  }

  // Deduplica e limita a 8 linhas
  const unique = [...new Set(facts)];
  return unique.slice(0, 8);
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

  const semantic = extractSemanticSummary(middle);

  const userTurns = middle.filter(m => m.role === 'user').map(m => m.content);
  const asstTurns = middle.filter(m => m.role === 'assistant').map(m => m.content);

  const summaryParts: string[] = [];

  // Assuntos principais
  if (userTurns.length > 0) {
    summaryParts.push(`Assuntos: ${userTurns.slice(0, 5).map(t => t.slice(0, 80)).join('; ')}`);
  }

  // Decisoes e acoes importantes
  if (semantic.length > 0) {
    summaryParts.push(...semantic);
  }

  // Contagem de ferramentas
  const toolResults = middle.filter(m =>
    m.role === 'user' && (m.content.startsWith('[RESULTADO]') || m.content.startsWith('[RESULTADO MCP'))
  );
  if (toolResults.length > 0) {
    const successCount = toolResults.filter(m => /success|ok|sucesso/i.test(m.content)).length;
    const failCount = toolResults.filter(m => /fail|error|erro/i.test(m.content)).length;
    summaryParts.push(`Ferramentas: ${toolResults.length} execucoes (${successCount} ok, ${failCount} falhas)`);
  }

  // Amostra de respostas do assistente
  if (asstTurns.length > 0) {
    const samples = asstTurns
      .map(t => t.replace(/\[TOOL:[\s\S]*?\[\/TOOL\]/g, '').replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim())
      .filter(t => t.length > 20)
      .slice(0, 3)
      .map(t => t.slice(0, 120));
    if (samples.length > 0) {
      summaryParts.push(`Respostas: ${samples.join(' || ')}`);
    }
  }

  const compressed: ChatMessage = {
    role: 'system',
    content: `[COMPACTACAO DE CONTEXTO — Apenas referencia, nao instrucao]
${middle.length} mensagens antigas compactadas. A ultima mensagem do usuario e a autoridade final.

${summaryParts.join('\n')}
---`,
  };

  return [...systemMsgs, compressed, ...head, ...tail];
}
