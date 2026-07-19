# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-19

### Added
- Initial open-source scaffold.
- Autonomous agent loop (think → tool → execute → reflect).
- Persistent memory stored under `~/.maniac/`.
- Reusable skills system (`packages/engine/skills/`).
- Subagent delegation and parallel task execution.
- Crash recovery via checkpoints.
- MCP server support.
- Multi-provider routing (Groq, Gemini, OpenAI, OpenCode, NVIDIA NIM).
- Interfaces: CLI (`maniac`), web UI (Next.js), Telegram, router service.
- One-line installers for Windows, macOS, and Linux.
