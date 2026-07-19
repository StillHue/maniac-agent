# maniac

<p align="center">
  <img src="docs/assets/maniac-mascot-wave.png" alt="Maniac chip mascot waving goodbye" width="220" />
</p>

<p align="center">
  <strong>The "what the hell, let's try it" agent for your maniac ideas.</strong><br />
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/StillHue/maniac-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/StillHue/maniac-agent/actions/workflows/ci.yml)
[![Status: experimental](https://img.shields.io/badge/status-experimental-orange.svg)](#status)

Maniac is an open source autonomous AI agent that runs on your machine. You give it a goal, it figures out how to get there — running tools, writing code, browsing files, making SSRF-safe HTTP requests, and talking to you on Telegram. It remembers what it learns, drafts skill/self-improvement **proposals** over time (apply only with explicit approval), and can modify its own source when you authorize it.

It is not a chatbot. It is not a coding assistant. It is the agent you spin up when you have an idea that sounds insane and you want to see if it actually works.

> [!WARNING]
> Maniac runs shell commands, writes files, and can modify and rebuild its own source code. Run it in an environment you trust — ideally a sandbox or VM — and review what it does before pointing it at anything important. See [SECURITY.md](SECURITY.md).

---

## Contents

- [Status](#status)
- [Install](#install)
- [What it does](#what-it-does)
- [Interfaces](#interfaces)
- [Quick start (manual)](#quick-start-manual)
- [Providers](#providers)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [Build](#build)
- [Contributing](#contributing)
- [License](#license)

---

## Status

Maniac is **experimental** (`v0.1.0`). Expect rough edges, breaking changes, and behavior that surprises you — that is part of the point. Feedback and contributions are very welcome.

---

## Install

Requires **Node.js 18+**, **Git**, and **Yarn** (the installer sets up Yarn for you if missing).

**Windows**
```powershell
irm https://raw.githubusercontent.com/StillHue/maniac-agent/main/scripts/install.ps1 | iex
```

**macOS / Linux**
```sh
curl -fsSL https://raw.githubusercontent.com/StillHue/maniac-agent/main/scripts/install.sh | sh
```

The installer clones Maniac into `~/.maniac/maniac-agent`, builds it, and adds a `maniac` command to your PATH. Then add at least one API key to `~/.maniac/maniac-agent/.env` (`GROQ_API_KEY` has a free tier) and run:

```sh
maniac
```

**Headless / scripting**

```sh
maniac -p "summarize this repo"           # NDJSON stream on stdout
maniac -p "run tests" --yolo              # auto-approve tool calls
maniac --continue                         # resume latest session (TUI)
maniac --resume <session-id>
```

In the TUI: **Shift+Tab** cycles chat/ask/plan; **Ctrl+T** cycles permission modes; dangerous tools prompt for approval in `default` mode. See `/help`.

> The one-line install gives you the **CLI**. The **web UI** and **Telegram** interfaces run from a manual clone — see [Quick start](#quick-start-manual).

---

## What it does

- **Runs autonomously** — give it a goal, it loops: thinks → picks tools → executes → reflects → repeats until done
- **Persistent memory** — remembers facts, preferences, and project context across sessions in `~/.maniac/`
- **Skills & proposals** — reusable procedures the agent can load/create; background autonomy only **drafts** improvement proposals (`/proposals`, `/approve <id>`) — it never silently mutates source, skills, or archives
- **Subagent delegation** — consecutive `[TOOL:delegate]` calls run in parallel (bounded, default 3, max 8), sharing cwd/permissions/cancellation
- **Crash recovery** — checkpoint v2 with per-tool ledger; on restart, safe read tools auto-replay and mutating tools ask for confirmation (`--no-auto-resume` to skip)
- **HTTP requests** — first-class `http_request` tool with SSRF protection (blocks private/link-local/metadata), redirect re-checks, timeouts, and `${ENV:MANIAC_HTTP_SECRET_*}` header refs (never raw API keys)
- **Provider routing** — switch providers in natural language (`use groq`, `usa anthropic`, `/model`) with correct key hydration per provider
- **MCP support** — connect any MCP server (Obsidian, GitHub, databases, browsers, etc.)
- **Self-modifying (gated)** — `source_edit` / rebuild require permission; background jobs cannot apply source proposals
- **Telegram** — bidirectional bot (`maniac telegram`) with allowlist, per-chat sessions, progress edits, and inline Approve/Reject for dangerous tools

---

## Interfaces

| Interface | How to run | Description |
|---|---|---|
| **CLI** | `maniac` | Full-screen terminal UI (installed globally, or `yarn build:cli` from a clone) |
| **Web** | `yarn dev` (from a clone) | Browser UI at `http://localhost:3000` |
| **Telegram** | `maniac telegram` | Bidirectional bot — requires `TELEGRAM_BOT_TOKEN` + allowlist |

---

## Quick start (manual)

```sh
git clone https://github.com/StillHue/maniac-agent
cd maniac-agent
cp .env.example .env   # edit and add at least one API key
yarn install
yarn dev               # web UI at http://localhost:3000
```

For the CLI:

```sh
yarn build:cli
maniac
```

---

## Providers

Maniac works with any of the providers below — add the key for **at least one**. You can also switch at runtime by telling the agent `use groq`, `use anthropic`, `use auto`, etc.

| Provider | Env var | Notes |
|---|---|---|
| Groq | `GROQ_API_KEY` | Free tier available. Llama models. Good default. |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, o-series. |
| Anthropic | `ANTHROPIC_API_KEY` | Claude models. |
| Google Gemini | `GEMINI_API_KEY` | Long context. |
| OpenRouter | `OPENROUTER_API_KEY` | One key, many models. |
| Mistral | `MISTRAL_API_KEY` | Mistral / Codestral. |
| xAI | `XAI_API_KEY` | Grok models. |
| Together AI | `TOGETHER_API_KEY` | Open-weight models. |
| NVIDIA NIM | `NVIDIA_API_KEY` | Nemotron. |
| OpenCode | `OPENCODE_API_KEY` | OpenCode Zen models (e.g. `big-pickle`). |
| Ollama | — | Local models, no key required (`http://localhost:11434`). |
| Custom | — | Any OpenAI-compatible endpoint. |
| Auto | — | Built-in router: OpenCode Zen free models primary (big-pickle → deepseek-v4-flash-free → nemotron-3-ultra-free → mimo-v2.5-free → north-mini-code-free), NVIDIA NIM last fallback. |

---

## Environment variables

Copy `.env.example` to `.env` and fill in what you need. All values are optional except **one** provider key.

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | Groq / Llama |
| `OPENAI_API_KEY` | — | OpenAI |
| `ANTHROPIC_API_KEY` | — | Anthropic / Claude |
| `GEMINI_API_KEY` | — | Google Gemini |
| `OPENROUTER_API_KEY` | — | OpenRouter |
| `MISTRAL_API_KEY` | — | Mistral |
| `XAI_API_KEY` | — | xAI / Grok |
| `TOGETHER_API_KEY` | — | Together AI |
| `NVIDIA_API_KEY` | — | NVIDIA NIM |
| `OPENCODE_API_KEY` | — | OpenCode |
| `TELEGRAM_BOT_TOKEN` | — | Telegram Bot API token |
| `TELEGRAM_ALLOWED_USER_IDS` | — | Comma-separated numeric user ids (required unless usernames/allow-all) |
| `TELEGRAM_ALLOWED_USERNAMES` | — | Comma-separated usernames (without `@`) |
| `TELEGRAM_ALLOW_ALL` | — | Set to `1` only for open bots (not recommended) |
| `MANIAC_NO_AUTO_RESUME` | — | Set to `1` to skip crash auto-resume on engine server |
| `MANIAC_MEMORY_DIR` | `~/.maniac/memory` | Where memory is stored |
| `MANIAC_BRAIN_VAULT` | — | Obsidian vault path (optional) |
| `MCP_CONFIG_PATH` | — | Path to MCP config JSON |
| `OPENCODE_CONFIG` | — | Alternate OpenCode/MCP config path |
| `MANIAC_WINDOWS_EXEC_BRIDGE` | — | Optional URL for remote Windows exec bridge |
| `PORT` | `3001` | Port for the optional router service (`yarn dev:service`) |

> The web UI runs on port **3000** (`yarn dev`); the optional router service runs on **3001** (`PORT`, `yarn dev:service`). They are independent.

---

## Project structure

```
apps/
  web/                      Next.js web UI + streaming API routes
packages/
  engine/                   Core agent loop, tools, memory, skills, MCP
  cli/                      Terminal UI built with Ink
  types/                    Shared TypeScript types
  prompts/                  Shared system prompts
services/
  maniac-agent-service/     Optional Express router (multi-provider routing)
scripts/
  install.ps1               Windows one-line installer
  install.sh                macOS/Linux one-line installer
docs/
  CODE_WIKI.md              Architecture & code walkthrough
```

---

## Build

```sh
yarn build:all        # types → prompts → engine → web
yarn build:cli        # CLI
yarn dev:service      # optional router service (port 3001)
yarn test             # run the test suite (Vitest)
```

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or pull request. For security reports, follow [SECURITY.md](SECURITY.md) — do not open a public issue.

---

## License

[MIT](LICENSE) © maniac contributors
