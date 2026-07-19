# `/sentinel` Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Add `/sentinel` slash command that runs an isolated readonly Bugbot-style review with OpenCode `north-mini-code-free`.

**Architecture:** New `runSentinelReview` in engine; CLI wires slash → harness-like call without touching chat history. Uses existing `chatWithProvider` for model override.

**Tech Stack:** TypeScript, Ink CLI, OpenCode Zen API, git via `exec` + `isReadOnlyShell`.

## Global Constraints

- Model fixed: `opencode` / `north-mini-code-free`
- No write/edit/delegate
- Do not mutate conversation history
- Homolog: no test files committed unless asked

---

### Task 1: Engine `runSentinelReview`

**Files:**
- Create: `packages/engine/src/sentinel.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/permissions/types.ts` (add `git merge-base`, `git symbolic-ref` to read-only prefixes)

- [ ] Implement `runSentinelReview` + export
- [ ] Build `@maniac/engine`

### Task 2: CLI `/sentinel`

**Files:**
- Modify: `packages/cli/src/commands.ts`
- Modify: `packages/cli/src/App.tsx`
- Modify: `packages/cli/src/index.tsx` (help mention if present)

- [ ] Slash handler + isolated run UI
- [ ] Build `@maniac/cli`
