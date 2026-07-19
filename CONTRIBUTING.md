# Contributing to Maniac

Thanks for your interest in improving Maniac! This document explains how to set up the project locally, the conventions we follow, and how to submit changes.

## Code of conduct

By participating in this project you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

Maniac is a Yarn workspaces monorepo.

```sh
git clone https://github.com/StillHue/maniac-agent
cd maniac-agent
cp .env.example .env   # add at least one API key
yarn install
```

## Useful scripts

| Command | Description |
|---|---|
| `yarn dev` | Run the web UI at http://localhost:3000 |
| `yarn build:all` | Build types → prompts → engine → web |
| `yarn build:cli` | Build the CLI (bin: `maniac`) |
| `yarn test` | Run the test suite (Vitest) |
| `yarn dev:service` | Run the optional router service (port 3001) |

## Project layout

```
apps/web/                 Next.js web UI + streaming API routes
packages/engine/          Core agent loop, tools, memory, skills, MCP
packages/cli/             Terminal UI built with Ink
packages/types/           Shared TypeScript types
packages/prompts/         Shared system prompts
services/maniac-agent-service/  Optional Express router
scripts/                  Installers and deploy helpers
```

## Making changes

1. Create a branch from `main`: `git checkout -b feat/my-change`.
2. Keep changes focused. One logical change per PR.
3. Run `yarn build:all` and `yarn test` before pushing.
4. Add or update tests for any behavior you change.
5. Update `README.md` / `docs/` when user-facing behavior changes.
6. Open a pull request with a clear description of the motivation and the change.

## Commit messages

Use short, imperative subject lines (e.g. `fix: handle missing API key`, `feat: add obsidian MCP tool`). Keep the body explanatory when needed.

## Reporting bugs & security issues

- For bugs and feature requests, open a GitHub issue.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) — do **not** open a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
