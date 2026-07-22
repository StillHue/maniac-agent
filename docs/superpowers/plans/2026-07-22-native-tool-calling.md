# Native Tool Calling Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Make Maniac’s agent loop use OpenAI-compatible native `tool_calls`, with text `[TOOL:]` fallback, better subagent budgets, and visible thinking in the CLI.

**Architecture:** Add tool schemas + arg serialization; extend the OpenAI-compat client to request/accumulate `tool_calls`; engine/delegation consume structured calls first; CLI shows `reasoning` live.

**Tech Stack:** TypeScript, existing `packages/engine` + Ink CLI, OpenCode Zen / OpenAI-compat APIs.

## Global Constraints

- Pure open source — no Cursor SDK.
- Providers remain OpenCode Zen free / existing config.
- Keep `[TOOL:]` fallback.
- Surgical changes; no unrelated refactors.

---

### Task 1: Types + OpenAI tool schemas

**Files:**
- Modify `packages/types/src/index.ts`
- Create `packages/engine/src/openai-tools.ts`

- [ ] Add `CompletionResult` / `NativeToolCall` (or export from engine)
- [ ] `buildOpenAITools(filter?)` from catalog
- [ ] `nativeArgsToCommand(name, argsJson)` → string for `executeToolCall`

### Task 2: Stream + request native tools in opencode.ts

**Files:**
- Modify `packages/engine/src/opencode.ts`

- [ ] Pass `tools` + `tool_choice: 'auto'` on chat/completions
- [ ] Accumulate streamed `tool_calls`
- [ ] Return `CompletionResult`
- [ ] On 4xx with tools, retry without tools
- [ ] Update `chatWithProvider` / exports

### Task 3: Wire engine + delegation

**Files:**
- Modify `packages/engine/src/engine.ts`
- Modify `packages/engine/src/delegation.ts`
- Modify `packages/engine/src/proactive.ts`
- Modify `packages/engine/src/sentinel.ts` if needed

- [ ] Prefer `result.toolCalls`, else `parseToolCalls`
- [ ] Raise child iterations / default timeout

### Task 4: CLI thinking region

**Files:**
- Modify `packages/cli/src/App.tsx`
- Modify `packages/cli/src/components/LiveArea.tsx`
- Modify `packages/cli/src/ui-types.ts` if needed

- [ ] Accumulate `reasoning` while loading
- [ ] Show truncated dim thinking block (grok-inspired)

### Task 5: Build verify

- [ ] `npm run build` at repo root (or package builds)
- [ ] Smoke: config still loads; types compile
