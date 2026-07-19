# MANIAC Code Wiki

## Visao Geral

O projeto e um monorepo Yarn com quatro areas principais:

- `apps/web`: frontend Next.js com App Router.
- `services/maniac-agent-service`: API Express independente para chat e healthcheck.
- `packages/engine`: nucleo do agente (tools, memory, skills, engine loop).
- `packages/types`: contratos TypeScript compartilhados.
- `packages/prompts`: prompts de sistema compartilhados.
- `packages/cli`: interface de linha de comando (Ink/React).

## Fluxo Web

1. `apps/web/app/page.tsx` renderiza a interface de chat.
2. `apps/web/app/api/chat/route.ts` recebe a mensagem via SSE e chama o engine.
3. `packages/engine/src/engine.ts` executa o loop agente: LLM → tools → loop.
4. `packages/engine/src/router.ts` define o system prompt e o modo (chat/ask/plan).

## Maniac Agent Service

O servico em `services/maniac-agent-service` expoe:

- `GET /health`
- `POST /api/chat`

Ele usa `src/router.ts` para decidir entre provedores, e `src/llm.ts` para chamar os LLMs.

## Pacotes Compartilhados

`packages/types/src/index.ts` define:

- `ChatMessage`
- `EngineMode`
- `StreamEvent` (inclui `subagent_start|token|tool|done`)
- `ChatRequest`
- `ChatResponse`

`packages/prompts/src/index.ts` define:

- `selfKnowledgePrompt`
- `cleanCodePrompt`
- `deepSearchPrompt`

## Engine — capacidades verificadas

| Modulo | Papel |
|---|---|
| `provider-switch.ts` | Troca de provider NL + hidratação de chave |
| `http/ssrf.ts` + `http/tools-http.ts` | `http_request` com proteção SSRF |
| `telegram/` | Bot bidirecional, allowlist, sessões, approvals inline |
| `concurrency.ts` + `delegation.ts` | Subagentes em paralelo (cap 1–8) |
| `immortality.ts` + `resume.ts` + `run-lock.ts` | Checkpoint v2, resume seguro, lock de run |
| `autonomy.ts` + `proposals/` | Autonomia proposal-only; apply via `/approve` |
| `curator.ts` | Em proposal-only: dry-run; archive só após approve |

## Scripts

- `yarn dev`: inicia o Next.js em `apps/web`.
- `yarn build:all`: compila types → prompts → engine → web.
- `yarn build:cli`: compila a CLI.
- `npx vitest run --dir packages/engine/test`: testes do engine.

## Ambiente

- Provider keys: ver `.env.example` / README.
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USER_IDS` / `TELEGRAM_ALLOWED_USERNAMES` para `maniac telegram`.
- `MANIAC_NO_AUTO_RESUME=1` para desligar auto-resume no server.
- `MANIAC_MEMORY_DIR`: diretório de memória (padrão: `~/.maniac/memory`).
- `MANIAC_BRAIN_VAULT`: vault Obsidian (opcional).
- `PORT`: porta do maniac-agent-service. Padrão: `3001`.

## Deploy

O `vercel.json` usa:

- `installCommand`: `yarn install`
- `buildCommand`: `yarn build:all`
- `devCommand`: `yarn workspace maniac-web dev`
