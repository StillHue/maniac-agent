import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolOutput } from './tools';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpServerState {
  name: string;
  config: McpServerConfig;
  client: Client | null;
  transport: StdioClientTransport | null;
  tools: McpToolInfo[];
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
  /** Qualified name: "serverName__toolName" */
  qualifiedName: string;
}

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.maniac');
const CONFIG_FILE = path.join(CONFIG_DIR, 'mcp.json');

const DEFAULT_CONFIG: McpConfig = {
  mcpServers: {},
};

export function loadMcpConfig(): McpConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return DEFAULT_CONFIG;
}

export function saveMcpConfig(config: McpConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function getMcpConfigPath(): string {
  return CONFIG_FILE;
}

// ─── Server Manager ────────────────────────────────────────────────────────

const servers = new Map<string, McpServerState>();

/**
 * Connect to a single MCP server.
 * Spawns the server process and discovers its tools.
 */
export async function connectMcpServer(config: McpServerConfig): Promise<McpServerState> {
  const name = config.name;

  // Disconnect existing if any
  if (servers.has(name)) {
    await disconnectMcpServer(name);
  }

  const state: McpServerState = {
    name,
    config,
    client: null,
    transport: null,
    tools: [],
    status: 'connecting',
  };
  servers.set(name, state);

  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...config.env } as Record<string, string>,
      cwd: config.cwd,
    });

    const client = new Client(
      { name: 'maniac-mcp-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);

    state.client = client;
    state.transport = transport;
    state.status = 'connected';

    // Discover tools
    const { tools } = await client.listTools();
    state.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
      serverName: name,
      qualifiedName: `${name}__${tool.name}`,
    }));

    return state;
  } catch (e: any) {
    state.status = 'error';
    state.error = e.message;
    return state;
  }
}

/**
 * Disconnect from an MCP server and clean up resources.
 */
export async function disconnectMcpServer(name: string): Promise<void> {
  const state = servers.get(name);
  if (!state) return;

  try {
    if (state.client) {
      await state.client.close();
    }
  } catch {}

  state.client = null;
  state.transport = null;
  state.tools = [];
  state.status = 'disconnected';
  servers.delete(name);
}

/**
 * Disconnect all MCP servers.
 */
export async function disconnectAllMcpServers(): Promise<void> {
  for (const name of servers.keys()) {
    await disconnectMcpServer(name);
  }
}

/**
 * Connect to all servers in the config.
 */
export async function connectAllMcpServers(config?: McpConfig): Promise<McpServerState[]> {
  const cfg = config || loadMcpConfig();
  const results: McpServerState[] = [];

  for (const [name, serverConfig] of Object.entries(cfg.mcpServers)) {
    if (serverConfig.enabled === false) continue;
    const state = await connectMcpServer({ ...serverConfig, name });
    results.push(state);
  }

  return results;
}

// ─── Tool Execution ────────────────────────────────────────────────────────

/**
 * Call an MCP tool by qualified name (serverName__toolName) or just toolName.
 */
export async function callMcpTool(
  qualifiedName: string,
  args: Record<string, unknown>,
): Promise<ToolOutput> {
  // Find the tool across all connected servers
  for (const state of servers.values()) {
    if (state.status !== 'connected') continue;

    const tool = state.tools.find(
      (t) => t.qualifiedName === qualifiedName || t.name === qualifiedName,
    );
    if (tool && state.client) {
      try {
        const result = await state.client.callTool({
          name: tool.name,
          arguments: args,
        });

        const content = result.content as Array<{ type: string; text?: string }>;
        const text = content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!)
          .join('\n');

        const isError = (result as { isError?: boolean }).isError === true;
        return {
          success: !isError,
          output: text || '(no text content returned)',
        };
      } catch (e: any) {
        return {
          success: false,
          output: `MCP tool error: ${e.message}`,
        };
      }
    }
  }

  return {
    success: false,
    output: `MCP tool "${qualifiedName}" not found in any connected server`,
  };
}

// ─── Discovery ─────────────────────────────────────────────────────────────

/**
 * Get all available MCP tools across all connected servers.
 */
export function listMcpTools(): McpToolInfo[] {
  const allTools: McpToolInfo[] = [];
  for (const state of servers.values()) {
    if (state.status === 'connected') {
      allTools.push(...state.tools);
    }
  }
  return allTools;
}

/**
 * Get status of all MCP servers.
 */
export function getMcpServerStatus(): McpServerState[] {
  return [...servers.values()];
}

/**
 * Find a tool by qualified name.
 */
export function findMcpTool(qualifiedName: string): McpToolInfo | undefined {
  for (const state of servers.values()) {
    if (state.status !== 'connected') continue;
    const tool = state.tools.find(
      (t) => t.qualifiedName === qualifiedName || t.name === qualifiedName,
    );
    if (tool) return tool;
  }
  return undefined;
}

// ─── Config Management ─────────────────────────────────────────────────────

/**
 * Add an MCP server to the config and connect to it.
 */
export async function addMcpServer(config: McpServerConfig): Promise<McpServerState> {
  const cfg = loadMcpConfig();
  cfg.mcpServers[config.name] = config;
  saveMcpConfig(cfg);
  return connectMcpServer(config);
}

/**
 * Remove an MCP server from the config and disconnect.
 */
export async function removeMcpServer(name: string): Promise<void> {
  const cfg = loadMcpConfig();
  delete cfg.mcpServers[name];
  saveMcpConfig(cfg);
  await disconnectMcpServer(name);
}

/**
 * Toggle an MCP server's enabled state.
 */
export async function toggleMcpServer(name: string): Promise<{ enabled: boolean; state: McpServerState | null }> {
  const cfg = loadMcpConfig();
  const server = cfg.mcpServers[name];
  if (!server) {
    return { enabled: false, state: null };
  }

  server.enabled = server.enabled === false ? true : false;
  saveMcpConfig(cfg);

  if (server.enabled === false) {
    await disconnectMcpServer(name);
    return { enabled: false, state: null };
  }

  const state = await connectMcpServer(server);
  return { enabled: true, state };
}
