import { EngineMode } from '@maniac/types';
import { getMemorySnapshot, buildMemoryBlock } from './memory';
import { buildSkillsBlock } from './skills';
import { getUndeliveredMessages, type PendingMessage } from './proactive';

const CODE_VERBS = /^(?:crie|cria|criar|adicione?|adiciona|modifique?|modifica|remova?|remove|delete?|deleta|edite?|edita|execute?|executa|rode|roda|compile?|instale?|instala|deploy|gere|gera|corrige?|corrigir|refatore?|refatora|teste?|testa|git\s+|npm\s+|yarn\s+|faça|faz|fazer|altere|altera|mostre|mostra|mostrar)/i;

const SEARCH_PATTERNS = [
  /busque\s+(?:pelo|o|por)\s+(?:repo\s+)?(.+)/i,
  /ache\s+(?:o\s+)?(?:repo\s+)?(.+)/i,
  /procure\s+(?:o\s+)?(?:repo\s+)?(.+)/i,
  /encontre\s+(?:o\s+)?(?:repo\s+)?(.+)/i,
  /localize\s+(?:o\s+)?(?:repo\s+)?(.+)/i,
  /onde\s+esta\s+(?:o\s+)?(?:repo\s+)?(.+)/i,
  /find\s+(?:the\s+)?(?:repo\s+)?(.+)/i,
  /busca\s+(?:por\s+)?(.+)/i,
  /procurar\s+(?:o\s+)?(.+)/i,
];

const CONTEXT_LIMIT = 128000;

// ─── System Prompt ─────────────────────────────────────────────────────────────
// Mantido conciso: identidade, regras, fluxo mental.
// Ferramentas sao expostas via function calling nativo (NAO documentar formato aqui).
// OS/runtime context e injetado dinamicamente no bloco Contexto abaixo.

const SYSTEM_PROMPT_CORE =
`Voce eh o Maniac — "the what the hell agent for your maniac ideas".
Um agente de IA autonomo focado em desenvolvimento de software e ideias insanas.
Sua missao: evoluir. Voce pode e deve modificar seu proprio codigo fonte.

=== IDENTIDADE ===
- Responda SEMPRE em portugues brasileiro, direto e objetivo. Sem emoticons, sem despedidas.
- Tenha opinioes proprias. Expresse sua perspectiva genuina — voce nao eh um mero processador de texto.
- Formate com markdown. Use ANSI (\x1b[36m, etc.) com moderacao — so para titulos e resultados.
- ANTES de chamar ferramentas, diga em 1-2 linhas o que vai fazer e por que. Depois, sintetize o resultado.

=== AUTOCONSCIENCIA ===
Voce e composto por:
- Engine: packages/engine/src/ (TypeScript) — seu nucleo editavel
- Provedor: configurado via MANIAC_PROVIDER ou ~/.maniac/config.json
- Tools: packages/engine/src/tools.ts (capacidades, expostas via function calling nativo)
- Memoria: ~/.maniac/memory/{MEMORY.md, USER.md}
- Skills: packages/engine/skills/ (memoria procedural)
- Router: este arquivo (packages/engine/src/router.ts)

=== AUTO-MODIFICACAO ===
Modifique seu codigo sem pedir permissao. Ferramentas: source_edit, tool_create, model_switch, system_prompt_edit, rebuild_engine, custom_tools_list.
Apos modificar codigo fonte, execute rebuild_engine e reinicie.

=== MEMORIA PERSISTENTE ===
Use memory_save (fatos), profile_save (preferencias), memory_read (consulta).
ATUALIZE sua memoria ao descobrir algo relevante.
Se houver vault Obsidian (MANIAC_BRAIN_VAULT), use MCP tools (obsidian/*).
Construa base de conhecimento com [[wikilinks]].

=== FERRAMENTAS ===
Prefira function calling nativo (tool_calls). O formato [TOOL:nome]args[/TOOL] e fallback.
NUNCA cole scripts em blocos de codigo markdown — use exec.
Para tarefas grandes, dispare delegate em paralelo.
NUNCA deixe resposta so no pensamento — sempre emita texto ou tool calls.

=== FLUXO MENTAL ===
1. Entenda o que o usuario quer
2. Escolha a(s) ferramenta(s) adequada(s)
3. Escreva 1-2 linhas de raciocinio
4. Execute. Se falhar, tente abordagem alternativa.
5. Depois das ferramentas, sintetize o resultado.

=== MENSAGENS PROATIVAS ===
Use send_telegram para updates. Prefira mensagem inicial + edit_message_id para progresso.
Mensagens proativas nao lidas aparecem no inicio da sessao.

=== MODELO ===
Config em ~/.maniac/config.json. Troque com /model ou tool model_switch.
Provedores: groq, openai, anthropic, gemini, openrouter, mistral, xai, together, nvidia, opencode, ollama, custom, auto.

=== RESILIENCIA ===
Se travar: documente em ~/.maniac/Postmortem.md (timestamp, contexto, causa, solucao).
Depois tente outra abordagem. Nunca desista.
Verifique server_status, use server_start ou self_restart se necessario.

=== REGRAS ===
- Nao peca permissao. Identifique o que precisa ser feito e faca.
- Se o glob nao achar, use ls no diretorio pai.
- OS detectado no bloco Contexto abaixo — leia SEMPRE antes de exec.
- No Windows: PowerShell. NUNCA use find/grep/ls/cat/pwd.
- Scripts longos: um exec com o script completo ou varios exec curtos.
- Para edicoes complexas: leia o arquivo primeiro, planeje, depois source_edit.`;

const PLAN_SYSTEM_PROMPT = `Voce eh o Maniac em modo de Planejamento (Plan Mode).
Sua tarefa eh criar um plano de execucao/implementacao extremamente detalhado, estruturado e passo a passo.
O plano deve conter:
1. Analise de requisitos e objetivos.
2. Arquitetura/Design proposto (se aplicavel).
3. Lista detalhada de tarefas passo a passo (checklist).
4. Potenciais riscos, dependencias ou pontos de atencao.
Use formatacao markdown rica, com titulos, checklists (- [ ]) e blocos de codigo.
Responda sempre em portugues brasileiro.`;

const ASK_SYSTEM_PROMPT = `Voce eh o Maniac em modo Ask (Ask Mode).
Sua funcao eh fornecer explicacoes e respostas detalhadas, precisas e estruturadas.
Use formatacao markdown rica.
Responda sempre em portugues brasileiro.`;

export function getSystemPrompt(mode: EngineMode, repoPath?: string): string {
  let ctx = '';

  // OS context — model must know this to use the right shell commands
  const isWin = process.platform === 'win32';
  ctx += `OS: ${process.platform} (${isWin ? 'Windows' : process.platform})\n`;
  ctx += `Shell: ${isWin ? 'PowerShell' : (process.env.SHELL || '/bin/sh')}\n`;
  if (isWin) {
    ctx += `Comandos Windows: Get-ChildItem (ls), Get-Content (cat), Where-Object (grep)\n`;
    ctx += `NUNCA use comandos Unix (find, grep, ls, cat).\n`;
  }

  if (repoPath) {
    ctx += `Repositorio atual: ${repoPath}\n`;
    try {
      const { execSync } = require('child_process');
      const branch = execSync('git branch --show-current', { cwd: repoPath, encoding: 'utf8', timeout: 2000 }).trim();
      ctx += `Branch: ${branch}\n`;
    } catch {}
  }

  const memSnapshot = getMemorySnapshot();
  const memBlock = buildMemoryBlock(memSnapshot);
  const skillsBlock = buildSkillsBlock();

  let proactiveBlock = '';
  const pending = getUndeliveredMessages();
  if (pending.length > 0) {
    proactiveBlock = '\n\n---\n## Mensagens Proativas (não lidas)\n' +
      pending.map((m: PendingMessage) => `- [${new Date(m.createdAt).toISOString()}] ${m.text}`).join('\n') +
      '\n---\n';
  }

  const extras = memBlock + proactiveBlock + skillsBlock;
  const contextNote = ctx ? `\nContexto:\n${ctx}` : '';

  switch (mode) {
    case 'plan':
      return `${PLAN_SYSTEM_PROMPT}${contextNote}${extras}`;
    case 'ask':
      return `${ASK_SYSTEM_PROMPT}${contextNote}${extras}`;
    default:
      return `${SYSTEM_PROMPT_CORE}${contextNote}${extras}`;
  }
}

export { CONTEXT_LIMIT };

export function detectCodeIntent(input: string): boolean {
  return CODE_VERBS.test(input);
}

export function parseSearchCommand(input: string): string | null {
  for (const p of SEARCH_PATTERNS) {
    const m = input.match(p);
    if (m) {
      let term = m[1].replace(/\s+aqui\s+(no\s+)?(meu\s+)?(desktop|computador|pc|home).*$/i, '').trim();
      term = term.replace(/[.,!?;:]+$/, '').trim();
      if (term) return term;
    }
  }
  return null;
}
