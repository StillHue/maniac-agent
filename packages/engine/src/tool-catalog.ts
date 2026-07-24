export interface ToolCatalogEntry {
  name: string;
  description: string;
  danger: boolean;
  params?: string;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  // ── Leitura / Exploracao ─────────────────────────────────────────────────
  { name: 'ls', description: 'Lista arquivos em um diretorio (ignora node_modules, .git)', danger: false },
  { name: 'read', description: 'Le conteudo de um arquivo (offset/limit opcional: "caminho offset limite")', danger: false },
  { name: 'grep', description: 'Busca texto em arquivos com regex (usa ripgrep se disponivel)', danger: false },
  { name: 'glob', description: 'Encontra arquivos por padrao glob (ex: **/*.ts)', danger: false },
  { name: 'delegate', description: 'Delega subtarefa paralela a subagente (otimo para exploracao/auditoria)', danger: true },

  // ── Escrita / Edicao ──────────────────────────────────────────────────────
  { name: 'write', description: 'Cria ou sobrescreve arquivo completamente', danger: true },
  { name: 'edit', description: 'Substitui texto exato em um arquivo (seguro: so muda o que acha)', danger: true },
  { name: 'apply_patch', description: 'Aplica diff unificado em um arquivo (formato Grok/Codex)', danger: true },
  { name: 'source_edit', description: 'Edita arquivos fonte do engine (com backup automatico .bak)', danger: true },
  { name: 'http_request', description: 'Faz requisicao HTTP com protecao SSRF (so MANIAC_HTTP_SECRET_*)', danger: true, params: 'JSON' },

  // ── Execucao ──────────────────────────────────────────────────────────────
  { name: 'exec', description: 'Executa comando shell (git, npm, node, compiladores, scripts)', danger: true },

  // ── Auto-modificacao ─────────────────────────────────────────────────────
  { name: 'tool_create', description: 'Cria nova ferramenta customizada em tempo real (requer MANIAC_ALLOW_CUSTOM_TOOLS=1)', danger: true },
  { name: 'model_switch', description: 'Troca o provedor/modelo ativo (ex: groq|llama-3.3-70b, ou so groq)', danger: false },
  { name: 'system_prompt_edit', description: 'Edita o system prompt em router.ts (com backup)', danger: true },
  { name: 'rebuild_engine', description: 'Recompila o engine apos modificar codigo fonte', danger: true },
  { name: 'custom_tools_list', description: 'Lista ferramentas customizadas registradas via tool_create', danger: false },
  { name: 'self_restart', description: 'Reinicia o processo maniac em novo terminal (requer MANIAC_ALLOW_SELF_RESTART=1)', danger: true },

  // ── Infra / Servidor ──────────────────────────────────────────────────────
  { name: 'spawn_terminal', description: 'Abre novo terminal no desktop', danger: true },
  { name: 'server_start', description: 'Inicia servidor HTTP persistente do maniac em background', danger: false },
  { name: 'server_status', description: 'Verifica se o servidor maniac esta rodando', danger: false },

  // ── Comunicacao ───────────────────────────────────────────────────────────
  { name: 'send_telegram', description: 'Envia ou edita mensagem Telegram. Use edit_message_id para editar mensagem anterior', danger: false },
  { name: 'telegram_list_chats', description: 'Lista contatos disponiveis no Telegram', danger: false },

  // ── Skills / Plugins / MCP ───────────────────────────────────────────────
  { name: 'skill', description: 'Gerencia skills: list, view <name>, run <name>', danger: false },
  { name: 'todo', description: 'Gerencia lista de tarefas: add, update, list, clear, remove', danger: false },
  { name: 'mcp', description: 'Gerencia servidores MCP: list, status, tools, add, remove, toggle, call', danger: false },
  { name: 'plugin', description: 'Plugin marketplace: list, search, install, remove, toggle', danger: true },
  { name: 'acp', description: 'Servidor ACP (Agent Communication Protocol): start, stop, status', danger: false },
  { name: 'sandbox', description: 'Sandbox de execucao: status, config <json>', danger: false },

  // ── Imortalidade / Checkpoint ────────────────────────────────────────────
  { name: 'immortality_save', description: 'Salva checkpoint manual da sessao', danger: false },
  { name: 'immortality_status', description: 'Status detalhado do sistema de imortalidade (checkpoint, heartbeat, crash)', danger: false },
  { name: 'immortality_resume', description: 'Inspeciona checkpoint; passe "confirm" para executar resume', danger: true },
  { name: 'immortality_forget', description: 'Limpa estado de imortalidade (checkpoint, heartbeat, crash)', danger: false },

  // ── Propostas de Melhoria ────────────────────────────────────────────────
  { name: 'proposal_list', description: 'Lista propostas de melhoria automaticas pendentes', danger: false },
  { name: 'proposal_show', description: 'Mostra detalhes de uma proposta de melhoria', danger: false },
  { name: 'proposal_apply', description: 'Aplica uma proposta de melhoria aprovada', danger: true },
  { name: 'proposal_reject', description: 'Rejeita uma proposta de melhoria', danger: false },
];
