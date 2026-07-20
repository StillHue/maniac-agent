export interface ToolCatalogEntry {
  name: string;
  description: string;
  danger: boolean;
  params?: string;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: 'ls', description: 'Lista arquivos em um diretorio', danger: false },
  { name: 'read', description: 'Le conteudo de um arquivo (suporta offset/limit: "path offset limit")', danger: false },
  { name: 'write', description: 'Escreve ou sobrescreve um arquivo', danger: true },
  { name: 'edit', description: 'Substitui texto exato em um arquivo', danger: true },
  { name: 'apply_patch', description: 'Aplica diff unificado em um arquivo (formato Grok/Codex)', danger: true },
  { name: 'grep', description: 'Busca texto em arquivos (usa ripgrep se disponivel)', danger: false },
  { name: 'glob', description: 'Encontra arquivos por padrao glob', danger: false },
  { name: 'exec', description: 'Executa comando shell', danger: true },
  { name: 'http_request', description: 'Faz requisicao HTTP (GET/POST/…) com protecao SSRF', danger: true, params: 'JSON' },
  { name: 'source_edit', description: 'Edita arquivos fonte do engine', danger: true },
  { name: 'tool_create', description: 'Cria nova ferramenta em tempo real', danger: true },
  { name: 'model_switch', description: 'Troca o modelo ativo', danger: false },
  { name: 'system_prompt_edit', description: 'Edita o system prompt', danger: true },
  { name: 'rebuild_engine', description: 'Recompila o engine', danger: true },
  { name: 'custom_tools_list', description: 'Lista ferramentas customizadas', danger: false },
  { name: 'spawn_terminal', description: 'Abre novo terminal', danger: true },
  { name: 'server_start', description: 'Inicia servidor HTTP', danger: false },
  { name: 'server_status', description: 'Status do servidor', danger: false },
  { name: 'self_restart', description: 'Reinicia o processo maniac', danger: true },
  { name: 'send_telegram', description: 'Envia/edita mensagem Telegram (use edit_message_id para editar)', danger: false },
  { name: 'telegram_list_chats', description: 'Lista contatos Telegram', danger: false },
  { name: 'delegate', description: 'Delega subtarefa a um subagente', danger: true },
  { name: 'skill', description: 'Gerencia skills: list, view <name>, run <name>', danger: false },
  { name: 'todo', description: 'Gerencia TODOs: add, update, list, clear, remove', danger: false },
  { name: 'mcp', description: 'Gerencia servidores MCP: list, status, tools, add, remove, toggle, call', danger: false },
  { name: 'plugin', description: 'Marketplace de plugins: list, search <query>, install <name>, remove <name>, toggle <name>', danger: true },
  { name: 'acp', description: 'Servidor ACP (Agent Communication Protocol): start, stop, status', danger: false },
  { name: 'sandbox', description: 'Sandbox de execucao: status, config <json>', danger: false },
  { name: 'immortality_save', description: 'Salva checkpoint manual da sessao atual', danger: false },
  { name: 'immortality_status', description: 'Mostra status detalhado do sistema de imortalidade', danger: false },
  { name: 'immortality_resume', description: 'Inspeciona checkpoint; passe "confirm" para executar resume seguro', danger: true },
  { name: 'immortality_forget', description: 'Limpa todo o estado de imortalidade (checkpoint, heartbeat, crash)', danger: false },
  { name: 'proposal_list', description: 'Lista propostas de melhoria pendentes', danger: false },
  { name: 'proposal_show', description: 'Mostra detalhes de uma proposta', danger: false },
  { name: 'proposal_apply', description: 'Aplica uma proposta aprovada', danger: true },
  { name: 'proposal_reject', description: 'Rejeita uma proposta', danger: false },
];