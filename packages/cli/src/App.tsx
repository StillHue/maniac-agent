import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Static, Text, useInput, useApp, type Key } from 'ink';
import {
  defaultHarness,
  loadManiacConfig,
  hasUsableProvider,
  getConfiguredProviders,
  setPermissionMode,
  loadPermissionConfig,
  listSessions,
  findLatestSession,
  loadSession,
  compressMessages,
  CONTEXT_LIMIT,
  globalPromptQueue,
  listProposals,
  applyProposal,
  updateProposalStatus,
  type PermissionMode,
  type PermissionPromptDecision,
} from '@maniac/engine';
import type { ChatMessage, StreamEvent } from '@maniac/types';
import {
  loadCliConfig,
  saveCliConfig,
  loadHistory,
  appendHistory,
  getGitInfo,
  estimateTokens,
  MAX_TOKENS,
  cycleEngineMode,
  cyclePermissionMode,
  type CliConfig,
  type GitInfo,
} from './cli-config.js';
import { visionAvailable } from '@maniac/engine';
import {
  captureClipboardImage,
  resolveMessageImages,
  type ImageAttachment,
} from './attachments.js';
import { Banner } from './components/Banner.js';
import { MessageItem } from './components/MessageItem.js';
import { renderMarkdown } from './markdown.js';
import { ACCENT } from './theme.js';
import { LiveArea } from './components/LiveArea.js';
import { Footer } from './components/Footer.js';
import { ModelWizard } from './components/ModelWizard.js';
import { PermissionOverlay } from './components/PermissionOverlay.js';
import { SlashMenu } from './components/SlashMenu.js';
import { HELP_TEXT, matchSlashCommands } from './commands.js';
import type {
  StaticItem,
  ToolCallView,
  SubagentStatus,
  PermissionPromptState,
} from './ui-types.js';
import { PERMISSION_OPTIONS } from './ui-types.js';

// Claude-style organic pulse: the asterisk "blooms" and shrinks
// (ping-pong) instead of spinning like braille dots.
const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

const MANIAC_THINKING = [
  'It makes sense?',
  'What the hell is that...',
  'Investigating btw',
  'Hold on, this is interesting',
  'Processing your madness',
  'Let me think about this...',
  'Connecting the dots',
  'Something is off here',
  "On it, don't panic",
  'This is actually wild',
  'Reading between the lines',
  'Running the numbers',
];

let _itemId = 1;
function nextId() {
  return _itemId++;
}

function getActiveModelLabel(): string {
  try {
    const cfg = loadManiacConfig();
    if (!cfg) return 'big-pickle';
    if (cfg.provider === 'auto') return 'auto';
    if (cfg.model && cfg.model !== 'auto') return cfg.model;
    return cfg.provider || 'big-pickle';
  } catch {
    return 'big-pickle';
  }
}

function useThinkingPhrase(active: boolean): string {
  const [phrase, setPhrase] = useState(MANIAC_THINKING[0]);
  const idx = useRef(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      idx.current = (idx.current + 1) % MANIAC_THINKING.length;
      setPhrase(MANIAC_THINKING[idx.current]);
    }, 2200);
    return () => clearInterval(t);
  }, [active]);
  return phrase;
}

export function App({
  initialSessionId,
  initialMessages,
}: {
  initialSessionId?: string;
  initialMessages?: ChatMessage[];
}) {
  const { exit } = useApp();

  const [cfg, setCfg] = useState<CliConfig>(() => {
    const c = loadCliConfig();
    const perm = loadPermissionConfig();
    return { ...c, permissionMode: c.permissionMode || perm.mode };
  });
  const cfgRef = useRef(cfg);
  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);

  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);
  // Welcome banner lives outside <Static> (Static output is permanent),
  // so it can be dismissed on the first user message to keep the UI clean.
  const [showBanner, setShowBanner] = useState<boolean>(
    !(initialMessages && initialMessages.length > 0),
  );
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(initialMessages || []);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [queueSize, setQueueSize] = useState(0);

  const [input, setInput] = useState('');
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  // Image attachments referenced in the input as [imageN] (pasted via Ctrl+V)
  const attachmentsRef = useRef<ImageAttachment[]>([]);
  const imageCounter = useRef(0);

  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(t);
  }, []);

  const slashMatches = matchSlashCommands(input);
  const [slashSelected, setSlashSelected] = useState(0);
  const slashMatchesRef = useRef(slashMatches);
  const slashSelectedRef = useRef(slashSelected);
  useEffect(() => {
    slashMatchesRef.current = slashMatches;
  }, [slashMatches]);
  useEffect(() => {
    slashSelectedRef.current = slashSelected;
  }, [slashSelected]);
  useEffect(() => {
    setSlashSelected(0);
  }, [input]);

  const [isLoading, setIsLoading] = useState(false);
  // Streaming response shown once, directly in the chat area (not the footer).
  const [liveText, setLiveText] = useState('');
  const [streamTools, setStreamTools] = useState<ToolCallView[]>([]);
  const [streamSubagents, setStreamSubagents] = useState<SubagentStatus[]>([]);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const abortControllerRef = useRef<AbortController | null>(null);

  const [permPrompt, setPermPrompt] = useState<PermissionPromptState | null>(null);
  const permResolveRef = useRef<((d: PermissionPromptDecision) => void) | null>(null);

  const [spinnerFrame, setSpinnerFrame] = useState(SPINNER_FRAMES[0]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const spinnerIdx = useRef(0);
  const runStartRef = useRef(0);
  useEffect(() => {
    if (!isLoading) return;
    runStartRef.current = Date.now();
    setElapsedSec(0);
    const t = setInterval(() => {
      spinnerIdx.current = (spinnerIdx.current + 1) % SPINNER_FRAMES.length;
      setSpinnerFrame(SPINNER_FRAMES[spinnerIdx.current]);
      setElapsedSec(Math.floor((Date.now() - runStartRef.current) / 1000));
    }, 120);
    return () => clearInterval(t);
  }, [isLoading]);

  const [termSize, setTermSize] = useState(() => ({
    cols: process.stdout.columns || 120,
    rows: process.stdout.rows || 24,
  }));
  useEffect(() => {
    const onResize = () =>
      setTermSize({ cols: process.stdout.columns || 120, rows: process.stdout.rows || 24 });
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  const [git, setGit] = useState<GitInfo>(() => getGitInfo());
  useEffect(() => {
    const t = setInterval(() => setGit(getGitInfo()), 5000);
    return () => clearInterval(t);
  }, []);

  const [activeModel, setActiveModel] = useState<string>(() => getActiveModelLabel());

  const isFirstBoot = useState<boolean>(() => {
    const mc = loadManiacConfig();
    if (mc) return false;
    return !hasUsableProvider();
  })[0];
  const [showModelWizard, setShowModelWizard] = useState<boolean>(isFirstBoot);

  useEffect(() => {
    if (isFirstBoot) return;
    if (!hasUsableProvider()) {
      const providers = getConfiguredProviders();
      const hint =
        providers.length === 0
          ? 'no API key found in environment'
          : `no usable key for configured provider (${providers.join(', ')})`;
      setStaticItems((prev) => [
        ...prev,
        {
          type: 'system',
          id: nextId(),
          text: `! no usable provider — ${hint}. Use /model or set an API key in .env.`,
          variant: 'warn',
        },
      ]);
    }
  }, [isFirstBoot]);

  const cmdHistory = useRef<string[]>(loadHistory());
  const historyIdx = useRef<number>(-1);
  const savedInput = useRef<string>('');
  const drainingRef = useRef(false);

  const requestPermission = useCallback(
    (req: { id: string; tool: string; args: string; reason?: string }) =>
      new Promise<PermissionPromptDecision>((resolve) => {
        permResolveRef.current = resolve;
        setPermPrompt({ ...req, selected: 0 });
      }),
    [],
  );

  const doRun = useCallback(
    async (message: string, history: ChatMessage[], mode: string, images: string[] = []) => {
      const abort = { aborted: false };
      abortRef.current = abort;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsLoading(true);
      setLiveText('');
      setStreamTools([]);
      setStreamSubagents([]);

      let fullText = '';
      let cleanedText = '';
      const tools: ToolCallView[] = [];
      const subagents: SubagentStatus[] = [];

      const stripToolMarkup = (text: string) =>
        text
          .replace(/\[TOOL:[\s\S]*$/gi, '')
          .replace(/\[?TOOL:[\w\/]+\]\s*[\s\S]*?\s*\[\/TOOL\]/gi, '')
          .trim();

      const clearLive = () => {
        setIsLoading(false);
        setLiveText('');
        setStreamTools([]);
        setStreamSubagents([]);
        setPermPrompt(null);
      };

      try {
        await defaultHarness.run({
          message,
          mode: mode as 'chat' | 'ask' | 'plan',
          history,
          images,
          sessionId,
          permissionMode: cfgRef.current.permissionMode,
          signal: controller.signal,
          onPermissionRequest: requestPermission,
          onEvent: (event: StreamEvent) => {
            if (abort.aborted) return;

            switch (event.type) {
              case 'token': {
                fullText += event.content;
                cleanedText = stripToolMarkup(fullText);
                setLiveText(cleanedText);
                break;
              }
              case 'reasoning': {
                // Non-streaming providers only emit the full text at once.
                if (!cleanedText) {
                  cleanedText = event.content;
                  setLiveText(cleanedText);
                }
                break;
              }
              case 'tool_start': {
                // Commit the narration that preceded this tool call to the
                // transcript, so it's read once and never re-rendered.
                if (cleanedText) {
                  const narration = cleanedText;
                  setStaticItems((prev) => [
                    ...prev,
                    { type: 'assistant', id: nextId(), text: narration, tools: [] },
                  ]);
                }
                fullText = '';
                cleanedText = '';
                setLiveText('');
                const tc: ToolCallView = { tool: event.tool, args: event.args, done: false };
                tools.push(tc);
                setStreamTools([...tools]);
                break;
              }
              case 'tool_output': {
                const tc = tools.find((t) => t.tool === event.tool && !t.done);
                if (tc) {
                  tc.output = ((tc.output || '') + event.chunk).slice(-400);
                  setStreamTools([...tools]);
                }
                break;
              }
              case 'tool_result': {
                const tc = tools.find((t) => t.tool === event.tool && !t.done);
                if (tc) {
                  tc.done = true;
                  tc.success = event.success;
                  tc.output = event.output;
                }
                setStreamTools([...tools]);
                break;
              }
              case 'subagent_start': {
                subagents.push({ id: event.id, goal: event.goal, done: false, tokenSnippet: '' });
                setStreamSubagents([...subagents]);
                break;
              }
              case 'subagent_token': {
                const sub = subagents.find((s) => s.id === event.id);
                if (sub) sub.tokenSnippet = event.content;
                setStreamSubagents([...subagents]);
                break;
              }
              case 'subagent_tool': {
                const sub = subagents.find((s) => s.id === event.id);
                if (sub) {
                  if (!event.done) sub.lastTool = event.tool;
                  else sub.tokenSnippet = '';
                }
                setStreamSubagents([...subagents]);
                break;
              }
              case 'subagent_done': {
                const sub = subagents.find((s) => s.id === event.id);
                if (sub) {
                  sub.done = true;
                  sub.success = event.success;
                  sub.tokenSnippet = event.summary.slice(0, 80);
                }
                setStreamSubagents([...subagents]);
                break;
              }
              case 'session': {
                setSessionId(event.sessionId);
                break;
              }
              case 'compact': {
                setStaticItems((prev) => [
                  ...prev,
                  {
                    type: 'system',
                    id: nextId(),
                    text: `compacted: ${event.summary.slice(0, 120)}`,
                    variant: 'info',
                  },
                ]);
                break;
              }
              case 'error': {
                fullText += `\n[error: ${event.message}]`;
                cleanedText = stripToolMarkup(fullText);
                setLiveText(cleanedText);
                break;
              }
            }
          },
        });
      } catch (e: unknown) {
        if (abort.aborted) {
          clearLive();
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setStaticItems((prev) => [
          ...prev,
          { type: 'system', id: nextId(), text: `✗ ${msg}`, variant: 'error' },
        ]);
        clearLive();
        return;
      }

      if (abort.aborted) {
        clearLive();
        return;
      }

      setStaticItems((prev) => [
        ...prev,
        { type: 'assistant', id: nextId(), text: fullText, tools: [...tools] },
      ]);
      setChatHistory((prev) => [...prev, { role: 'assistant', content: fullText }]);
      clearLive();
    },
    [requestPermission, sessionId],
  );

  const drainQueue = useCallback(async () => {
    if (drainingRef.current || isLoading) return;
    const next = globalPromptQueue.dequeue();
    setQueueSize(globalPromptQueue.size);
    if (!next) return;
    drainingRef.current = true;
    try {
      setStaticItems((prev) => [...prev, { type: 'user', id: nextId(), text: next.text }]);
      const hist = chatHistory;
      setChatHistory((prev) => [...prev, { role: 'user', content: next.text }]);
      const queuedImages = resolveMessageImages(next.text, attachmentsRef.current);
      attachmentsRef.current = attachmentsRef.current.filter(
        (a) => !next.text.includes(a.placeholder),
      );
      await doRun(next.text, hist, cfgRef.current.mode, queuedImages);
    } finally {
      drainingRef.current = false;
      if (globalPromptQueue.size > 0) void drainQueue();
    }
  }, [chatHistory, doRun, isLoading]);

  useEffect(() => {
    if (!isLoading && globalPromptQueue.size > 0) void drainQueue();
  }, [isLoading, drainQueue]);

  const handleSlash = useCallback(
    (raw: string) => {
      const [cmd, ...rest] = raw.slice(1).split(' ');
      const arg = rest.join(' ').trim();

      switch (cmd.toLowerCase()) {
        case 'help':
          setStaticItems((prev) => [
            ...prev,
            { type: 'system', id: nextId(), text: HELP_TEXT, variant: 'info' },
          ]);
          break;

        case 'exit':
        case 'quit':
          saveCliConfig(cfgRef.current);
          exit();
          break;

        case 'clear':
        case 'new':
          setChatHistory([]);
          setSessionId(undefined);
          setStaticItems([]);
          setShowBanner(true);
          break;

        case 'compact': {
          const compressed = compressMessages(
            [{ role: 'system', content: '' }, ...chatHistory],
            CONTEXT_LIMIT,
          );
          const withoutSystem = compressed.filter((m) => m.role !== 'system');
          setChatHistory(withoutSystem);
          setStaticItems((prev) => [
            ...prev,
            {
              type: 'system',
              id: nextId(),
              text: `✓ compacted to ${withoutSystem.length} messages`,
              variant: 'success',
            },
          ]);
          break;
        }

        case 'mode':
          if (['chat', 'ask', 'plan'].includes(arg)) {
            const newCfg = { ...cfgRef.current, mode: arg as CliConfig['mode'] };
            setCfg(newCfg);
            saveCliConfig(newCfg);
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: `✓ mode: ${arg}`, variant: 'success' },
            ]);
          } else {
            setStaticItems((prev) => [
              ...prev,
              {
                type: 'system',
                id: nextId(),
                text: '✗ valid modes: chat, ask, plan',
                variant: 'error',
              },
            ]);
          }
          break;

        case 'permissions':
        case 'permission': {
          const modes: PermissionMode[] = [
            'default',
            'acceptEdits',
            'plan',
            'dontAsk',
            'bypassPermissions',
          ];
          if (modes.includes(arg as PermissionMode)) {
            const mode = arg as PermissionMode;
            setPermissionMode(mode);
            const newCfg = { ...cfgRef.current, permissionMode: mode };
            setCfg(newCfg);
            saveCliConfig(newCfg);
            setStaticItems((prev) => [
              ...prev,
              {
                type: 'system',
                id: nextId(),
                text: `✓ permission mode: ${mode}`,
                variant: 'success',
              },
            ]);
          } else {
            setStaticItems((prev) => [
              ...prev,
              {
                type: 'system',
                id: nextId(),
                text: `✗ valid: ${modes.join(', ')}`,
                variant: 'error',
              },
            ]);
          }
          break;
        }

        case 'model':
          setShowModelWizard(true);
          break;

        case 'resume': {
          const cwd = process.cwd();
          if (!arg) {
            const sessions = listSessions(cwd, 10);
            if (sessions.length === 0) {
              setStaticItems((prev) => [
                ...prev,
                { type: 'system', id: nextId(), text: 'no sessions for this directory', variant: 'info' },
              ]);
            } else {
              const lines = sessions
                .map(
                  (s) =>
                    `  ${s.id.slice(0, 16)}  ${new Date(s.updatedAt).toISOString().slice(0, 16)}  ${s.title}  (${s.numMessages} msgs)`,
                )
                .join('\n');
              setStaticItems((prev) => [
                ...prev,
                {
                  type: 'system',
                  id: nextId(),
                  text: `sessions:\n${lines}\n\nuse /resume <id>`,
                  variant: 'info',
                },
              ]);
            }
          } else {
            const rec = loadSession(cwd, arg);
            if (!rec) {
              setStaticItems((prev) => [
                ...prev,
                { type: 'system', id: nextId(), text: `session not found: ${arg}`, variant: 'error' },
              ]);
            } else {
              setSessionId(rec.summary.id);
              setChatHistory(rec.messages);
              setShowBanner(false);
              setStaticItems([
                {
                  type: 'system',
                  id: nextId(),
                  text: `✓ resumed ${rec.summary.id} (${rec.messages.length} messages)`,
                  variant: 'success',
                },
              ]);
            }
          }
          break;
        }

        case 'continue': {
          const latest = findLatestSession(process.cwd());
          if (!latest) {
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: 'no prior session', variant: 'info' },
            ]);
          } else {
            const rec = loadSession(process.cwd(), latest.id);
            if (rec) {
              setSessionId(rec.summary.id);
              setChatHistory(rec.messages);
              setShowBanner(false);
              setStaticItems([
                {
                  type: 'system',
                  id: nextId(),
                  text: `✓ continued ${rec.summary.id}`,
                  variant: 'success',
                },
              ]);
            }
          }
          break;
        }

        case 'history':
          if (chatHistory.length === 0) {
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: 'history empty', variant: 'info' },
            ]);
          } else {
            const lines = chatHistory
              .map(
                (m) =>
                  `  ${m.role === 'user' ? 'you' : 'maniac'}  ${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}`,
              )
              .join('\n');
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: lines, variant: 'info' },
            ]);
          }
          break;

        case 'proposals': {
          const items = listProposals(arg === 'all' ? undefined : ('pending' as any));
          if (!items.length) {
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: 'no pending proposals', variant: 'info' },
            ]);
          } else {
            const lines = items
              .map(
                (p) =>
                  `  ${p.id}  [${p.status}]  ${p.kind}  score=${p.evidence.score.toFixed(2)}  ${p.title}`,
              )
              .join('\n');
            setStaticItems((prev) => [
              ...prev,
              {
                type: 'system',
                id: nextId(),
                text: `proposals:\n${lines}\n\n/approve <id>  or  /reject <id>`,
                variant: 'info',
              },
            ]);
          }
          break;
        }

        case 'approve': {
          if (!arg) {
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: 'usage: /approve <proposal-id>', variant: 'error' },
            ]);
            break;
          }
          void applyProposal(arg, process.cwd()).then((r) => {
            setStaticItems((prev) => [
              ...prev,
              {
                type: 'system',
                id: nextId(),
                text: r.output,
                variant: r.success ? 'success' : 'error',
              },
            ]);
          });
          break;
        }

        case 'reject': {
          if (!arg) {
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: 'usage: /reject <proposal-id>', variant: 'error' },
            ]);
            break;
          }
          const p = updateProposalStatus(arg, 'rejected');
          setStaticItems((prev) => [
            ...prev,
            {
              type: 'system',
              id: nextId(),
              text: p ? `✓ rejected ${arg}` : `✗ proposal not found: ${arg}`,
              variant: p ? 'success' : 'error',
            },
          ]);
          break;
        }

        default:
          setStaticItems((prev) => [
            ...prev,
            {
              type: 'system',
              id: nextId(),
              text: `unknown command: /${cmd}  (use /help)`,
              variant: 'error',
            },
          ]);
      }
    },
    [chatHistory, exit],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      appendHistory(trimmed);
      cmdHistory.current.push(trimmed);
      historyIdx.current = -1;
      savedInput.current = '';

      if (trimmed.startsWith('/')) {
        setInput('');
        handleSlash(trimmed);
        return;
      }

      setInput('');
      setShowBanner(false);

      if (isLoading) {
        globalPromptQueue.enqueue(trimmed);
        setQueueSize(globalPromptQueue.size);
        setStaticItems((prev) => [
          ...prev,
          {
            type: 'system',
            id: nextId(),
            text: `queued (${globalPromptQueue.size})`,
            variant: 'info',
          },
        ]);
        return;
      }

      const images = resolveMessageImages(trimmed, attachmentsRef.current);
      if (images.length > 0) {
        // Consume the attachments referenced by this message
        attachmentsRef.current = attachmentsRef.current.filter(
          (a) => !trimmed.includes(a.placeholder),
        );
        if (!visionAvailable()) {
          setStaticItems((prev) => [
            ...prev,
            {
              type: 'system',
              id: nextId(),
              text: '! image attached but GROQ_API_KEY is not set — vision routing disabled',
              variant: 'warn',
            },
          ]);
        }
      }

      setStaticItems((prev) => [...prev, { type: 'user', id: nextId(), text: trimmed }]);
      const newHistory = [...chatHistory, { role: 'user' as const, content: trimmed }];
      setChatHistory(newHistory);
      void doRun(trimmed, chatHistory, cfgRef.current.mode, images);
    },
    [chatHistory, handleSlash, doRun, isLoading],
  );

  useInput((inputChar: string, key: Key) => {
    if (permPrompt) {
      if (key.escape) {
        permResolveRef.current?.('deny');
        permResolveRef.current = null;
        setPermPrompt(null);
        return;
      }
      if (key.upArrow) {
        setPermPrompt((p) => (p ? { ...p, selected: Math.max(0, p.selected - 1) } : p));
        return;
      }
      if (key.downArrow) {
        setPermPrompt((p) =>
          p ? { ...p, selected: Math.min(PERMISSION_OPTIONS.length - 1, p.selected + 1) } : p,
        );
        return;
      }
      if (inputChar >= '1' && inputChar <= '3') {
        const idx = Number(inputChar) - 1;
        setPermPrompt((p) => (p ? { ...p, selected: idx } : p));
        return;
      }
      if (key.return && permPrompt) {
        const decision = PERMISSION_OPTIONS[permPrompt.selected].key as PermissionPromptDecision;
        permResolveRef.current?.(decision);
        permResolveRef.current = null;
        setPermPrompt(null);
        return;
      }
      return;
    }

    const cancelRun = () => {
      abortRef.current.aborted = true;
      abortControllerRef.current?.abort();
      setIsLoading(false);
      setLiveText('');
      setStreamTools([]);
      setStreamSubagents([]);
      if (permResolveRef.current) {
        permResolveRef.current('deny');
        permResolveRef.current = null;
        setPermPrompt(null);
      }
      setStaticItems((prev) => [
        ...prev,
        { type: 'system', id: nextId(), text: 'cancelled', variant: 'warn' },
      ]);
    };

    if (key.ctrl && inputChar === 'c') {
      if (isLoading) {
        cancelRun();
        return;
      }
      saveCliConfig(cfgRef.current);
      exit();
      return;
    }

    // Esc cancels the current run (Grok/Claude-style interrupt)
    if (key.escape && isLoading && !permPrompt) {
      cancelRun();
      return;
    }

    if (showModelWizard) return;

    // Shift+Tab → cycle engine mode
    if (key.tab && key.shift) {
      const next = cycleEngineMode(cfgRef.current.mode);
      const newCfg = { ...cfgRef.current, mode: next };
      setCfg(newCfg);
      saveCliConfig(newCfg);
      setStaticItems((prev) => [
        ...prev,
        { type: 'system', id: nextId(), text: `mode → ${next}`, variant: 'info' },
      ]);
      return;
    }

    // Ctrl+V → attach image from clipboard as [imageN]
    if (key.ctrl && inputChar === 'v') {
      const img = captureClipboardImage();
      if (img) {
        imageCounter.current += 1;
        const placeholder = `[image${imageCounter.current}]`;
        attachmentsRef.current.push({ placeholder, path: img });
        setInput((prev) => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + placeholder + ' ');
        setStaticItems((prev) => [
          ...prev,
          {
            type: 'system',
            id: nextId(),
            text: `✓ image attached as ${placeholder} (${img})`,
            variant: 'success',
          },
        ]);
      }
      // No image in clipboard → let the terminal's own text paste happen
      return;
    }

    // Ctrl+T → cycle permission mode
    if (key.ctrl && inputChar === 't') {
      const next = cyclePermissionMode(cfgRef.current.permissionMode);
      setPermissionMode(next);
      const newCfg = { ...cfgRef.current, permissionMode: next };
      setCfg(newCfg);
      saveCliConfig(newCfg);
      setStaticItems((prev) => [
        ...prev,
        { type: 'system', id: nextId(), text: `permissions → ${next}`, variant: 'info' },
      ]);
      return;
    }

    // Slash command menu navigation (while typing `/...`)
    const menu = slashMatchesRef.current;
    if (menu && !(key.tab && key.shift)) {
      if (key.upArrow) {
        setSlashSelected((i) => (i - 1 + menu.length) % menu.length);
        return;
      }
      if (key.downArrow) {
        setSlashSelected((i) => (i + 1) % menu.length);
        return;
      }
      if (key.tab) {
        const cmd = menu[Math.min(slashSelectedRef.current, menu.length - 1)];
        setInput(`/${cmd.name}${cmd.args ? ' ' : ''}`);
        return;
      }
      if (key.return) {
        const cmd = menu[Math.min(slashSelectedRef.current, menu.length - 1)];
        if (cmd.args) {
          setInput(`/${cmd.name} `);
        } else {
          handleSubmit(`/${cmd.name}`);
        }
        return;
      }
    }

    if (isLoading && !permPrompt) {
      // Allow typing to queue via enter only after characters — still accept input to queue
      if (key.return) {
        handleSubmit(inputRef.current);
        return;
      }
      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.escape) return;
      if (!inputChar) return;
      setInput((prev) => prev + inputChar);
      return;
    }

    if (key.return) {
      handleSubmit(inputRef.current);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (key.upArrow) {
      const hist = cmdHistory.current;
      if (hist.length === 0) return;
      if (historyIdx.current === -1) {
        savedInput.current = inputRef.current;
        historyIdx.current = hist.length - 1;
      } else if (historyIdx.current > 0) {
        historyIdx.current--;
      }
      setInput(hist[historyIdx.current] ?? '');
      return;
    }

    if (key.downArrow) {
      const hist = cmdHistory.current;
      if (historyIdx.current === -1) return;
      if (historyIdx.current < hist.length - 1) {
        historyIdx.current++;
        setInput(hist[historyIdx.current] ?? '');
      } else {
        historyIdx.current = -1;
        setInput(savedInput.current);
      }
      return;
    }

    if (key.ctrl || key.meta || key.escape) return;
    if (!inputChar) return;

    setInput((prev) => prev + inputChar);
  });

  const usedTokens = estimateTokens(chatHistory);
  const { cols, rows } = termSize;
  const thinkingPhrase = useThinkingPhrase(isLoading);

  if (showModelWizard) {
    return (
      <Box flexDirection="column">
        <ModelWizard
          isFirstBoot={isFirstBoot}
          onDone={(msg) => {
            setShowModelWizard(false);
            setActiveModel(getActiveModelLabel());
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: `✓ ${msg}`, variant: 'success' },
            ]);
          }}
          onCancel={() => setShowModelWizard(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item: StaticItem) => (
          <Box
            key={item.id}
            // Static items don't inherit the terminal width in Ink, so "100%"
            // resolves to the content's intrinsic size and long lines overflow
            // instead of word-wrapping. An explicit column width fixes it.
            width={cols}
          >
            <MessageItem item={item} />
          </Box>
        )}
      </Static>

      {showBanner && !isLoading && <Banner />}

      {isLoading && <LiveArea tools={streamTools} subagents={streamSubagents} rows={rows} />}

      {isLoading && liveText ? (
        <Box paddingLeft={2} paddingRight={2} width={cols}>
          <Box flexShrink={0}>
            <Text dimColor>maniac  </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text>
              {renderMarkdown(liveText)}
              {cursorVisible ? <Text color={ACCENT}>▌</Text> : <Text> </Text>}
            </Text>
          </Box>
        </Box>
      ) : null}

      {permPrompt && <PermissionOverlay prompt={permPrompt} />}

      {!permPrompt && slashMatches && (
        <SlashMenu commands={slashMatches} selected={Math.min(slashSelected, slashMatches.length - 1)} />
      )}

      <Footer
        git={git}
        tokens={usedTokens}
        maxTokens={MAX_TOKENS}
        mode={cfg.mode}
        permissionMode={cfg.permissionMode}
        cols={cols}
        value={input}
        cursorVisible={cursorVisible}
        isLoading={isLoading && !permPrompt}
        spinnerFrame={spinnerFrame}
        thinkingPhrase={thinkingPhrase}
        elapsedSec={elapsedSec}
        activeModel={activeModel}
        queueSize={queueSize}
        sessionId={sessionId}
      />
    </Box>
  );
}
