# Maniac

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status: experimental](https://img.shields.io/badge/status-experimental-orange.svg)
![GitHub Repo stars](https://img.shields.io/github/stars/StillHue/maniac-agent?style=social)

**Maniac** is an open source autonomous AI agent that runs on your machine. You give it a goal, it figures out how to get there — running tools, writing code, browsing files, making SSRF-safe HTTP requests, and talking to you on Telegram. It learns, improves, and can modify its own source when authorized.

> **Not** a chatbot. **Not** a coding assistant. The agent you spin up when you have an idea that sounds insane and you want to see if it actually works.

> [!WARNING]
> Maniac runs shell commands, writes files, and can modify and rebuild its own source code. Run it in a trusted environment — ideally a sandbox or VM — and review what it does before pointing it at anything important. See [SECURITY.md](SECURITY.md).

---

## Quick Start

**Installation:** `npm install -g maniac-agent` (or use one-line installer below)

**Setup:** Add at least one API key (e.g., `GROQ_API_KEY`) and run:

```sh
maniac
```

**One-line installer (requires Node.js 18+, Git, Yarn):**

Windows:
```powershell
irm https://raw.githubusercontent.com/StillHue/maniac-agent/main/scripts/install.ps1 | iex
```

macOS/Linux:
```sh
curl -fsSL https://raw.githubusercontent.com/StillHue/maniac-agent/main/scripts/install.sh | sh
```

**Basic commands:**
- `maniac -p "your goal"` - Run with a prompt
- `maniac --continue` - Resume latest session
- `maniac telegram` - Start Telegram bot
- `maniac --help` - Show all options

---

## What It Does

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

## Installation

### Global installation (recommended)

```sh
npm install -g maniac-agent
# or
bun install -g maniac-agent
```

### One-line installer (clones from GitHub)

Requires **Node.js 18+**, **Git**, and **Yarn**.

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

### Manual clone (for web UI and Telegram)

```sh
git clone https://github.com/StillHue/maniac-agent
cd maniac-agent
cp .env.example .env   # edit and add at least one API key
yarn install
yarn dev               # web UI at http://localhost:3000
```

For the CLI from a clone:

```sh
yarn build:cli
maniac
```

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
| Auto | — | Built-in router: tries available providers in priority order. |

## Environment Variables

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

## Project Structure

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

## Build & Run

```sh
npm install          # or bun install / yarn install
yarn build:all       # types → prompts → engine → web
yarn build:cli       # CLI
yarn dev:service     # optional router service (port 3001)
yarn test            # run the test suite (Vitest)
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or pull request. For security reports, follow [SECURITY.md](SECURITY.md) — do not open a public issue.

## License

[MIT](LICENSE) © maniac contributors