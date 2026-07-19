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

Maniac can modify its own source. When running untrusted goals, run in an isolated environment and review changes the agent makes before committing them.

## Permissions

Interactive CLI sessions use a permission pipeline before dangerous tools run:

- Modes: `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`
- Config: `~/.maniac/permissions.json`
- Per-project remembered grants: `~/.maniac/grants/`
- Cycle modes in the TUI with `Ctrl+T`, or `/permissions <mode>`
- Headless runs default to `dontAsk` unless `--yolo` / `--dangerously-skip-permissions` is set
