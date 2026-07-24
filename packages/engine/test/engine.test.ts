import { describe, it, expect, afterEach } from 'vitest';
import { TOOL_CATALOG } from '../src/tool-catalog';
import { registerHook, unregisterHook, listHooks } from '../src/hooks';
import { looksLikeDeferredIntent } from '../src/engine';
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

describe('looksLikeDeferredIntent', () => {
  it('flags soft-quit exploration promises', () => {
    expect(
      looksLikeDeferredIntent(
        'Vou explorar mais a fundo pra te mostrar um panorama real do que to rodando.',
      ),
    ).toBe(true);
    expect(looksLikeDeferredIntent('Let me check the repo structure next.')).toBe(true);
  });

  it('ignores real answers', () => {
    expect(
      looksLikeDeferredIntent(
        'Aqui está o panorama: o engine vive em packages/engine e o CLI em packages/cli.',
      ),
    ).toBe(false);
    expect(looksLikeDeferredIntent('')).toBe(false);
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
