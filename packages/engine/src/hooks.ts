export type HookPhase = 'pre' | 'post';

export interface HookContext {
  tool: string;
  args: string;
  cwd: string;
  result?: { success: boolean; output: string };
}

export type HookFn = (ctx: HookContext) => void | Promise<void>;

interface HookEntry {
  id: string;
  tool: string | '*';
  phase: HookPhase;
  fn: HookFn;
}

const hooks: HookEntry[] = [];

export function registerHook(
  tool: string | '*',
  phase: HookPhase,
  fn: HookFn,
): string {
  const id = `hook_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`;
  hooks.push({ id, tool, phase, fn });
  return id;
}

export function unregisterHook(id: string): void {
  const idx = hooks.findIndex(h => h.id === id);
  if (idx !== -1) hooks.splice(idx, 1);
}

export async function runHooks(phase: HookPhase, ctx: HookContext): Promise<void> {
  for (const h of hooks) {
    if (h.phase !== phase) continue;
    if (h.tool !== '*' && h.tool !== ctx.tool) continue;
    try {
      await h.fn(ctx);
    } catch {}
  }
}

export function listHooks(): Array<{ id: string; tool: string; phase: HookPhase }> {
  return hooks.map(h => ({ id: h.id, tool: h.tool, phase: h.phase }));
}
