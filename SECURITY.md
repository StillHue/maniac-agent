# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `main` | ✅ Yes |
| older releases | ❌ No |

## Reporting a vulnerability

If you discover a security vulnerability in Maniac, please **do not open a public GitHub issue**.

Instead, report it privately by opening a [GitHub Security Advisory](https://github.com/StillHue/maniac-agent/security/advisories/new) on this repository. We will acknowledge your report within a few business days and keep you informed as we work on a fix.

## Secrets & API keys

- Maniac requires API keys (Groq, Gemini, OpenAI, OpenCode, NVIDIA) and an optional Telegram token.
- Never commit `.env`, secrets, or credentials. They are git-ignored.
- Use `.env.example` as a template and keep real values only in your local environment.
- The agent stores memory under `~/.maniac/` by default. Do not commit that directory.

## Self-modifying behavior

Maniac can modify its own source via permission-gated tools (`source_edit`, `rebuild_engine`). Background autonomy is **proposal-only**: it may draft proposals under `~/.maniac/proposals/` but never applies them without `/approve`, Telegram/web approval, or an explicit user-authorized tool call. When running untrusted goals, use an isolated environment and review changes before committing.

## Permissions

Interactive CLI sessions use a permission pipeline before dangerous tools run:

- Modes: `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`
- Config: `~/.maniac/permissions.json`
- Per-project remembered grants: `~/.maniac/grants/`
- Cycle modes in the TUI with `Ctrl+T`, or `/permissions <mode>`
- Headless runs default to `dontAsk` unless `--yolo` / `--dangerously-skip-permissions` is set

## Telegram

- Bot refuses to start without `TELEGRAM_ALLOWED_USER_IDS` / `TELEGRAM_ALLOWED_USERNAMES` (or explicit `TELEGRAM_ALLOW_ALL=1`).
- Unauthorized users cannot execute tools.
- Dangerous tools require inline Approve/Reject; timeout denies.

## HTTP (`http_request`)

- Blocks loopback, private, link-local, and cloud metadata targets (SSRF).
- Redirects are re-validated; response size and timeouts are capped.
- `${ENV:NAME}` secret references are resolved server-side and never echoed in logs/output.

## Crash recovery

- Checkpoints never store API keys.
- Auto-resume replays only safe read-only pending tools; mutating tools require confirmation.
- Run locks prevent two processes from claiming the same run.