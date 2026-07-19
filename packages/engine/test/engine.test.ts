import { describe, it, expect, afterEach } from 'vitest';
import { TOOL_CATALOG } from '../src/tool-catalog';
import { registerHook, unregisterHook, listHooks } from '../src/hooks';
import type { ToolCatalogEntry } from '../src/tool-catalog';

describe('tool catalog', () => {
  it('exposes a non-empty catalog of tools', () => {
    expect(Array.isArray(TOOL_CATALOG)).toBe(true);
    expect(TOOL_CATALOG.length).toBeGreaterThan(0);
  });

  it('has unique tool names', () => {
    const names = TOOL_CATALOG.map((t: ToolCatalogEntry) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks destructive tools as danger', () => {
    const write = TOOL_CATALOG.find((t) => t.name === 'write');
    expect(write?.danger).toBe(true);
  });
});

describe('hooks', () => {
  afterEach(() => {
    for (const h of listHooks()) {
      unregisterHook(h.id);
    }
  });

  it('registers and lists a hook', () => {
    const id = registerHook('before_tool', async () => {});
    const hooks = listHooks();
    expect(hooks.some((h) => h.id === id)).toBe(true);
  });

  it('unregisters a hook', () => {
    const id = registerHook('after_tool', async () => {});
    unregisterHook(id);
    expect(listHooks().some((h) => h.id === id)).toBe(false);
  });
});
