import { saveMemory, saveUserProfile } from './memory';

interface ReviewContext {
  userMessage: string;
  assistantReply: string;
  toolCalls: { type: string; success: boolean }[];
}

const MEMORY_TRIGGERS = [
  /aprendi/, /descobri/, /entendi/, /percebi/, /notei/, /observei/,
  /importante saber/, /vale registrar/, /guarde isso/, /nao esqueca/,
  /fato interessante/, /curiosidade/, /padrao/, /sempre que/,
  /costuma/, /prefere/, /gosta de/, /nao gosta de/,
  /trabalha com/, /usa ferramenta/, /projeto atual/,
];

const PROFILE_TRIGGERS = [
  /prefiro/, /prefere/, /gosto de/, /nao gosto/,
  /meu estilo/, /meu jeito/, /costumo/,
];

export function evaluateMemorySave(ctx: ReviewContext): void {
  const combined = `${ctx.userMessage}\n${ctx.assistantReply}`.toLowerCase();

  const hasTools = ctx.toolCalls.some(t => t.success);
  const replyLines = ctx.assistantReply.split('\n').length;
  const hasSubstance = replyLines > 3 && ctx.assistantReply.length > 100;

  if (!hasTools && !hasSubstance) return;

  const memMatches = MEMORY_TRIGGERS.filter(r => r.test(combined));
  const profileMatches = PROFILE_TRIGGERS.filter(r => r.test(combined));

  if (memMatches.length > 0 && hasSubstance) {
    const snippet = ctx.assistantReply
      .replace(/\*\*Raciocínio:\*\*[\s\S]*?\n/, '')
      .split('\n')
      .filter(l => l.trim().length > 20)
      .slice(0, 3)
      .join('; ')
      .slice(0, 300);

    if (snippet.length > 20) {
      const tags = memMatches.map(m => m.source.slice(1, -1)).join(', ');
      saveMemory(`[background-review] ${snippet}\n  _tags: ${tags}_`);
    }
  }

  if (profileMatches.length > 0 && hasSubstance) {
    const snippet = ctx.assistantReply
      .split('\n')
      .filter(l => profileMatches.some(r => r.test(l.toLowerCase())))
      .slice(0, 2)
      .join('; ')
      .slice(0, 200);

    if (snippet.length > 10) {
      saveUserProfile(`[background-review] ${snippet}`);
    }
  }
}
