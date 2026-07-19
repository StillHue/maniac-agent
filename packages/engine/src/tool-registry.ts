import { TOOL_CATALOG, type ToolCatalogEntry } from './tool-catalog';
import { executeToolCall } from './tools';

export interface ToolRegistration extends ToolCatalogEntry {
  handler?: (
    args: string,
    cwd: string,
  ) => Promise<{ success: boolean; output: string }> | { success: boolean; output: string };
}

const registry = new Map<string, ToolRegistration>();

function seedFromCatalog(): void {
  if (registry.size > 0) return;
  for (const entry of TOOL_CATALOG) {
    registry.set(entry.name, { ...entry });
  }
}

export function registerCatalogTool(tool: ToolRegistration): void {
  seedFromCatalog();
  registry.set(tool.name, tool);
}

export function getCatalogTool(name: string): ToolRegistration | undefined {
  seedFromCatalog();
  return registry.get(name);
}

export function listRegisteredTools(): ToolRegistration[] {
  seedFromCatalog();
  return [...registry.values()];
}

export function isDangerousTool(name: string): boolean {
  seedFromCatalog();
  const t = registry.get(name);
  if (t) return t.danger;
  return false;
}

/** Execute via custom handler if present, else fall through to executeToolCall. */
export async function runRegisteredTool(
  name: string,
  args: string,
  cwd: string,
): Promise<{ success: boolean; output: string }> {
  seedFromCatalog();
  const tool = registry.get(name);
  if (tool?.handler) {
    return await tool.handler(args, cwd);
  }
  return executeToolCall(name, args, cwd);
}
