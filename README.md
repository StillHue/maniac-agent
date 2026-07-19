# maniac

**the what the hell agent for your maniac ideas**

Maniac is an open source autonomous AI agent that runs on your machine. You give it a goal, it figures out how to get there — running tools, writing code, browsing files, calling APIs, talking to you on Telegram. It remembers what it learns, builds skills over time, and can modify its own source when it finds a better way to do something.

It is not a chatbot. It is not a coding assistant. It is the agent you spin up when you have an idea that sounds insane and you want to see if it actually works.

---

## Install

**Windows**
```powershell
irm https://raw.githubusercontent.com/StillHue/maniac-agent/main/scripts/install.ps1 | iex
```

**macOS / Linux**
```sh
curl -fsSL https://raw.githubusercontent.com/StillHue/maniac-agent/main/scripts/install.sh | sh
```

Then add your API key to `~/.maniac/maniac-agent/.env` and run:

```sh
maniac
```

---

## What it does

- **Runs autonomously** — give it a goal, it loops: thinks → picks tools → executes → reflects → repeats until done
- **Persistent memory** — remembers facts, preferences, and project context across sessions in `~/.maniac/`
- **Skills** — reusable procedures the agent can load, create, and improve over time
- **Subagent delegation** — breaks big tasks into parallel subtasks
- **Crash recovery** — saves checkpoints before every critical operation, resumes after restart
- **MCP support** — connect any MCP server (Obsidian, GitHub, databases, browsers, etc.)
- **Self-modifying** — the agent can edit its own source code and rebuild
- **Telegram** — talk to your agent from your phone

---

## Interfaces

| Interface | How to run | Description |
|---|---|---|
| **CLI** | `maniac` | Full-screen terminal UI |
| **Web** | `yarn dev` | Browser UI at `localhost:3000` |
| **Telegram** | set `TELEGRAM_BOT_TOKEN` | Chat from anywhere |

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

Maniac works with any of these — add the key for at least one:

| Provider | Env var | Notes |
|---|---|---|
| Groq | `GROQ_API_KEY` | Free tier available. Llama models. Good default. |
| Google Gemini | `GEMINI_API_KEY` | Long context. |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, o3. |
| OpenCode | `OPENCODE_API_KEY` | north models. |
| NVIDIA NIM | `NVIDIA_API_KEY` | Nemotron. |

Switch provider at runtime: tell the agent `use groq` or `use gemini`.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | Groq / Llama |
| `GEMINI_API_KEY` | — | Google Gemini |
| `OPENAI_API_KEY` | — | OpenAI |
| `OPENCODE_API_KEY` | — | OpenCode / north |
| `NVIDIA_API_KEY` | — | NVIDIA NIM |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot |
| `MANIAC_MEMORY_DIR` | `~/.maniac/memory` | Where memory is stored |
| `MANIAC_BRAIN_VAULT` | — | Obsidian vault path (optional) |
| `MCP_CONFIG_PATH` | — | Path to MCP config JSON |
| `PORT` | `3001` | Port for the optional router service |

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
```

---

## Build

```sh
yarn build:all        # types → prompts → engine → web
yarn build:cli        # CLI
yarn dev:service      # optional router service (port 3001)
```

---

## License

[MIT](LICENSE)
