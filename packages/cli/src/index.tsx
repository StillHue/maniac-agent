#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { findLatestSession, loadSession, runTelegramBot, tryAutoResume } from '@maniac/engine';
import { App } from './App.js';
import { parseCliArgs, runHeadless } from './headless.js';

process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
// The TUI draws its own fake cursor; re-show the real one on the way out.
process.on('exit', () => {
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25h');
});

const args = parseCliArgs(process.argv);

if (args.help) {
  console.log(`maniac — the what the hell agent

Usage:
  maniac                     interactive TUI
  maniac telegram            bidirectional Telegram bot
  maniac -p "prompt"         headless NDJSON stream
  maniac -p "..." --yolo     headless, auto-approve tools
  maniac -p "..." -i x.png   attach image (routed via Groq vision)
  maniac -p "..." --output-format text   plain text output (final answer only)
  maniac --resume [id]       resume session (TUI)
  maniac --continue          resume latest session for cwd
  maniac --no-auto-resume    skip crash auto-resume on startup

Interactive:
  Shift+Tab   cycle mode (chat/ask/plan)
  Ctrl+T      cycle permission mode
  Alt+V       attach clipboard image as [imageN] (also /paste; Ctrl+V works
              in terminals that intercept it for text paste)
  /help       list slash commands
  /sentinel   Bugbot review (uncommitted); /sentinel branch vs main
  /proposals  list improvement proposals
  /approve id apply a proposal
  /reject id  reject a proposal

Headless output formats:
  --output-format ndjson       all events as JSON lines (default)
  --output-format text         plain text, only the final answer

Tools (Grok Build enhanced):
  read "path [offset [limit]]"   read file with line range
  grep "pattern [path]"          search (uses ripgrep if installed)
  apply_patch "path\\n---\\n<diff>"   apply unified diff
  skill list|view|run <name>     manage skills
  todo add|update|list|clear     task management

Telegram requires TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS
(or TELEGRAM_ALLOWED_USERNAMES). Dangerous tools ask via inline buttons.

Images: text-only code models (NVIDIA/OpenCode) can't see images, so
attachments are described by the Groq vision model (GROQ_API_KEY required)
and the description is injected into the code model's prompt.
`);
  process.exit(0);
}

async function main() {
  if (args.telegram) {
    await runTelegramBot({ cwd: process.cwd() });
    process.exit(0);
  }

  // Safe crash auto-resume (read-only pending tools; mutations skipped)
  if (!args.noAutoResume && !args.headless) {
    try {
      const outcome = await tryAutoResume({ enabled: true });
      if (outcome?.resumed) {
        console.log(`[immortality] ${outcome.message}`);
        if (outcome.reply) {
          console.log(outcome.reply.slice(0, 2000));
        }
      }
    } catch (e: any) {
      console.error(`[immortality] auto-resume failed: ${e.message}`);
    }
  }

  if (args.headless) {
    if (!args.prompt) {
      console.error('error: -p requires a prompt string');
      process.exit(1);
    }
    let sessionId: string | undefined;
    let history = undefined;
    const cwd = process.cwd();
    if (args.continueLatest) {
      const latest = findLatestSession(cwd);
      if (latest) {
        const rec = loadSession(cwd, latest.id);
        sessionId = latest.id;
        history = rec?.messages;
      }
    } else if (args.resume) {
      const rec = loadSession(cwd, args.resume);
      if (!rec) {
        console.error(`error: session not found: ${args.resume}`);
        process.exit(1);
      }
      sessionId = rec.summary.id;
      history = rec.messages;
    }
    await runHeadless({
      prompt: args.prompt,
      yolo: args.yolo,
      sessionId,
      history,
      cwd,
      images: args.images,
      outputFormat: args.outputFormat,
    });
    process.exit(0);
  }

  let initialSessionId: string | undefined;
  let initialMessages = undefined;
  const cwd = process.cwd();
  if (args.continueLatest) {
    const latest = findLatestSession(cwd);
    if (latest) {
      const rec = loadSession(cwd, latest.id);
      initialSessionId = latest.id;
      initialMessages = rec?.messages;
    }
  } else if (args.resume) {
    const rec = loadSession(cwd, args.resume);
    if (rec) {
      initialSessionId = rec.summary.id;
      initialMessages = rec.messages;
    }
  }

  // Clear screen, home the cursor, and hide the terminal's hardware cursor —
  // the TUI renders its own; otherwise both blink side by side.
  process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');
  render(<App initialSessionId={initialSessionId} initialMessages={initialMessages} />);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
