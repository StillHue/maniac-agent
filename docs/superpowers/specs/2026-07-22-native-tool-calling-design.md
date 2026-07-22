# Native tool calling + open-source harness quality

**Date:** 2026-07-22  
**Status:** Approved (user: “pode começar”)  
**Constraints:** Pure open source. No Cursor SDK. Providers stay as configured (OpenCode Zen free / existing auto-router). Tool calling must work well even if we build it.

## Problem

Maniac dies on large tasks because tools are emitted as free-text `[TOOL:…]` and parsed after the fact. Weak models leak CoT, dump scripts as markdown, or skip the protocol. Subagents inherit the same fragility (20-iter cap).

## Goals

1. Prefer **OpenAI-compatible native** `tools` / `tool_calls` on the chat completions path used by OpenCode Zen, Groq, etc.
2. Keep **text `[TOOL:…]` as fallback** when the model ignores tools or the API rejects the tools payload.
3. Borrow UX patterns from [grok-build](https://github.com/xai-org/grok-build) (Apache-2.0): stream reasoning into a collapsible thinking region; do not hide it forever.
4. Raise subagent budgets so long explorations do not abort early.

## Non-goals

- Embedding the Rust `grok` binary or requiring xAI auth.
- Cursor SDK / closed runtimes.
- Rewriting the entire TUI to match Grok pixel-for-pixel.

## Design

### Completion result

`callOpenCode` / OpenAI-compat path returns:

```ts
{ content: string; toolCalls: { id: string; type: string; command: string }[] }
```

Engine and subagents: if `toolCalls.length > 0`, execute those; else `parseToolCalls(content)`.

### Tool schemas

Map catalog tools to JSON Schema `function` tools. Core tools (`ls`, `read`, `write`, `edit`, `grep`, `glob`, `exec`, `delegate`, …) get structured properties; remaining tools get `{ input: string }` serialized into the existing `executeToolCall` command string.

### Message loop

Phase 1 keeps feeding results as `user` `[RESULTADO]` messages (compatible with current compressor/checkpoint). Phase 2 (later) may switch to `role: tool` + `tool_call_id` when providers prove reliable.

### Streaming

Accumulate `delta.tool_calls[i]` by index; emit `reasoning` as today; CLI renders thinking live (dim / truncated), inspired by grok-build ThinkingBlock.

### Failure mode

If the provider returns HTTP 4xx on a request that included `tools`, retry once without `tools` and fall back to text protocol.

## Attribution

UI/behavior inspiration from xai-org/grok-build (Apache-2.0). No vendored Rust code in this change set.
