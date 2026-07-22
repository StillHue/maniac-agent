import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { ToolOutput } from './tools';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PluginMeta {
  name: string;
  version: string;
  description: string;
  author?: string;
  repository?: string;
  tools?: string[]; // Names of tools added by this plugin
  skills?: string[]; // Names of skills added by this plugin
  mcpServers?: string[]; // Names of MCP servers added by this plugin
}

export interface PluginEntry {
  name: string;
  source: 'npm' | 'git' | 'local' | 'url';
  location: string; // path or identifier
  enabled: boolean;
  installedAt: string;
  meta: PluginMeta;
}

export interface PluginsConfig {
  plugins: Record<string, PluginEntry>;
}

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.maniac');
const PLUGINS_DIR = path.join(CONFIG_DIR, 'plugins');
const CONFIG_FILE = path.join(CONFIG_DIR, 'plugins.json');

const DEFAULT_CONFIG: PluginsConfig = {
  plugins: {},
};

export function loadPluginsConfig(): PluginsConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[plugins] loadPluginsConfig falhou:', e);
  }
  return DEFAULT_CONFIG;
}

export function savePluginsConfig(config: PluginsConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// ─── Plugin Manager ────────────────────────────────────────────────────────

/**
 * List all installed plugins and their status.
 */
export function listPlugins(): { success: boolean; output: string } {
  const config = loadPluginsConfig();
  const entries = Object.values(config.plugins);
  
  if (entries.length === 0) {
    return { success: true, output: 'Nenhum plugin instalado.' };
  }

  const lines = entries.map(p => {
    const status = p.enabled ? '●' : '○';
    const tools = p.meta.tools?.length ? ` tools: ${p.meta.tools.length}` : '';
    const skills = p.meta.skills?.length ? ` skills: ${p.meta.skills.length}` : '';
    return `  ${status} ${p.name}@${p.meta.version} — ${p.meta.description}${tools}${skills}`;
  });

  return { success: true, output: `Plugins instalados (${entries.length}):\n${lines.join('\n')}` };
}

/**
 * Install a plugin from npm.
 * (Placeholder for full installation logic - downloads and registers)
 */
export async function installPlugin(name: string): Promise<ToolOutput> {
  // Em um cenário real, faria: npm install <name> --prefix ~/.maniac/plugins/<name>
  // Aqui vamos simular o registro para validar a estrutura.
  
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  const config = loadPluginsConfig();
  
  // Mock meta discovery
  const meta: PluginMeta = {
    name,
    version: '1.0.0',
    description: `Plugin ${name} instalado via marketplace`,
    tools: [`${name}_tool`],
  };

  config.plugins[name] = {
    name,
    source: 'npm',
    location: path.join(PLUGINS_DIR, name),
    enabled: true,
    installedAt: new Date().toISOString(),
    meta,
  };

  savePluginsConfig(config);
  return { success: true, output: `Plugin "${name}" instalado e habilitado com sucesso.` };
}

/**
 * Uninstall a plugin.
 */
export function uninstallPlugin(name: string): ToolOutput {
  const config = loadPluginsConfig();
  if (!config.plugins[name]) {
    return { success: false, output: `Plugin "${name}" não encontrado.` };
  }

  delete config.plugins[name];
  savePluginsConfig(config);
  
  // No mundo real: fs.rmSync(path.join(PLUGINS_DIR, name), { recursive: true, force: true });
  
  return { success: true, output: `Plugin "${name}" desinstalado.` };
}

/**
 * Toggle plugin status.
 */
export function togglePlugin(name: string): ToolOutput {
  const config = loadPluginsConfig();
  if (!config.plugins[name]) {
    return { success: false, output: `Plugin "${name}" não encontrado.` };
  }

  config.plugins[name].enabled = !config.plugins[name].enabled;
  savePluginsConfig(config);
  
  const status = config.plugins[name].enabled ? 'habilitado' : 'desabilitado';
  return { success: true, output: `Plugin "${name}" ${status}.` };
}

/**
 * Search for plugins (Mock implementation for the marketplace concept).
 */
export function searchPlugins(query: string): ToolOutput {
  // Em uma implementação real, consultaria um registro central ou npm search
  const available = [
    { name: 'maniac-plugin-web-search', description: 'Real-time web search capabilities using Google/Serper' },
    { name: 'maniac-plugin-docker', description: 'Docker container management and inspection tools' },
    { name: 'maniac-plugin-aws', description: 'Cloud infrastructure tools for AWS' },
    { name: 'maniac-plugin-notion', description: 'Integration with Notion workspace' },
  ];

  const results = available.filter(p => 
    p.name.includes(query) || p.description.toLowerCase().includes(query.toLowerCase())
  );

  if (results.length === 0) {
    return { success: true, output: `Nenhum plugin encontrado para "${query}".` };
  }

  const lines = results.map(r => `  ${r.name}: ${r.description}`);
  return { success: true, output: `Plugins disponíveis para "${query}":\n${lines.join('\n')}` };
}
