# Design: `/sentinel` in maniac CLI

**Date:** 2026-07-19  
**Status:** Approved

## Goal

Expose Cursor-style Bugbot/Sentinel as a maniac slash command that audits local git diffs for critical bugs and security issues — report only, no fixes.

## Decisions

| Topic | Choice |
|-------|--------|
| Scope | `/sentinel` → uncommitted; `/sentinel branch` → branch changes |
| Runtime | Dedicated `runSentinelReview()` (not EngineMode) |
| Session | Isolated — empty history; do not mutate chat session |
| Model | OpenCode Zen `north-mini-code-free` via `chatWithProvider` (does not change active chat model) |
| Tools | Allow: `ls`, `read`, `grep`, `glob`, `exec` (read-only shell only via `isReadOnlyShell`) |
| Block | `write`, `edit`, `delegate`, and all other tools |
| Permissions | No interactive prompts |
| Out of scope v1 | Auto-fix, report file, Telegram/headless, commit gating |

## CLI

- Register in `SLASH_COMMANDS` + `/help`
- If agent already running → refuse with short message
- Banner: `◆ Sentinel · uncommitted|branch · north-mini-code-free`
- Stream tools/tokens in live UI; final report as static assistant bubble (not chatHistory)
- Esc aborts

## Engine

`runSentinelReview({ cwd, scope, onEvent, signal? })`:

1. System prompt = Sentinel/Bugbot workflow (diff collection, audit priorities, severity table, report format)
2. User message = `Full Repository Path` + `Diff: …`
3. Tool loop ≤ 20 iterations using `chatWithProvider(..., { provider: 'opencode', model: 'north-mini-code-free' })`
4. Emit standard `StreamEvent`s; return final report string

## Self-review

- No placeholders left
- Model id matches AUTO_SLOTS (`north-mini-code-free`)
- Aligns with approved chat design
