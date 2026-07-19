#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { findLatestSession, loadSession } from '@maniac/engine';
import { App } from './App.js';
import { parseCliArgs, runHeadless } from './headless.js';

process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

const args = parseCliArgs(process.argv);

if (args.help) {
  console.log(`maniac — the what the hell agent

Usage:
  maniac                     interactive TUI
  maniac -p "prompt"         headless NDJSON stream
  maniac -p "..." --yolo     headless, auto-approve tools
  maniac --resume [id]       resume session (TUI)
  maniac --continue          resume latest session for cwd

Interactive:
  Shift+Tab   cycle mode (chat/ask/plan)
  Ctrl+T      cycle permission mode
  /help       list slash commands
`);
  process.exit(0);
}

async function main() {
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
    });
    return;
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

  process.stdout.write('\x1b[2J\x1b[H');
  render(<App initialSessionId={initialSessionId} initialMessages={initialMessages} />);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
