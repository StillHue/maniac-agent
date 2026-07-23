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
  runSentinelReview,
  parseSentinelArg,
  SENTINEL_MODEL,
  type PermissionMode,
  type PermissionPromptDecision,
  type QueueEntry,
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
import { ExpandableThought } from './components/ThoughtBlock.js';
import { Footer } from './components/Footer.js';
import { QueuePanel } from './components/QueuePanel.js';
import { ModelWizard } from './components/ModelWizard.js';
import { PermissionOverlay } from './components/PermissionOverlay.js';
import { UpdateOverlay, type UpdatePhase } from './components/UpdateOverlay.js';
import { SlashMenu } from './components/SlashMenu.js';
import { HELP_TEXT, matchSlashCommands } from './commands.js';
import {
  checkForUpdate,
  detectInstaller,
  runUpdate,
  skipUpdate,
  type Installer,
  type UpdateInfo,
} from './update-check.js';
import type {
  StaticItem,
  ToolCallView,
  SubagentStatus,
  PermissionPromptState,
  ThoughtEntry,
} from './ui-types.js';
import { PERMISSION_OPTIONS } from './ui-types.js';

// Braille spinner — dingbats like ✻/✽ render as green emoji tiles in
// Windows Terminal, so keep frames in the monochrome braille block.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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

/** Keep the live region short so Ink never scrolls the prompt off-screen. */
function clipToLastLines(text: string, maxLines: number): string {
  if (maxLines <= 0 || !text) return '';
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return `…\n${lines.slice(-(maxLines - 1)).join('\n')}`;
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
  const chatHistoryRef = useRef(chatHistory);
  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const syncQueue = useCallback(() => {
    setQueueEntries(globalPromptQueue.list());
  }, []);

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
  const [liveThinking, setLiveThinking] = useState('');
  /** Latest thought — only this one can expand (mutable). Older ones freeze into Static. */
  const [latestThought, setLatestThought] = useState<ThoughtEntry | null>(null);
  const latestThoughtRef = useRef<ThoughtEntry | null>(null);
  const [thoughtExpanded, setThoughtExpanded] = useState(false);
  const [streamTools, setStreamTools] = useState<ToolCallView[]>([]);
  const [streamSubagents, setStreamSubagents] = useState<SubagentStatus[]>([]);
  const [subagentDispatchCount, setSubagentDispatchCount] = useState(0);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Guards double-Enter on Windows terminals. */
  const submitLockRef = useRef(false);
  /** Remount Static after a hard clear (Windows resize stamp fix). */
  const [staticEpoch, setStaticEpoch] = useState(0);

  const [permPrompt, setPermPrompt] = useState<PermissionPromptState | null>(null);
  const permResolveRef = useRef<((d: PermissionPromptDecision) => void) | null>(null);
  const permPromptRef = useRef<PermissionPromptState | null>(null);
  useEffect(() => {
    permPromptRef.current = permPrompt;
  }, [permPrompt]);

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
    }, 220);
    return () => clearInterval(t);
  }, [isLoading]);

  const [termSize, setTermSize] = useState(() => ({
    cols: process.stdout.columns || 120,
    rows: process.stdout.rows || 24,
  }));
  const colsRef = useRef(termSize.cols);
  colsRef.current = termSize.cols;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      // Debounce — Windows fires many resize events; each redraw can stamp UI.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setTermSize({
          cols: process.stdout.columns || 120,
          rows: process.stdout.rows || 24,
        });
        // Hard clear + remount Static so Ink doesn't leave ghost copies (win32).
        if (process.platform === 'win32' && process.stdout.isTTY) {
          process.stdout.write('\x1b[2J\x1b[H');
          setStaticEpoch((e) => e + 1);
        }
      }, 80);
    };
    process.stdout.on('resize', onResize);
    return () => {
      if (timer) clearTimeout(timer);
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

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('ask');
  const [updateInstaller, setUpdateInstaller] = useState<Installer>(() => detectInstaller());
  const [updateError, setUpdateError] = useState<string | undefined>();
  const updateBusyRef = useRef(false);
  const pendingUpdateRef = useRef<UpdateInfo | null>(null);

  const dismissUpdate = useCallback((rememberSkip: boolean) => {
    if (rememberSkip && updateInfo) skipUpdate(updateInfo.latest);
    setUpdateInfo(null);
    setUpdatePhase('ask');
    setUpdateError(undefined);
  }, [updateInfo]);

  const presentUpdateIfIdle = useCallback((info: UpdateInfo) => {
    // Never interrupt an active run or permission prompt (Sentinel HIGH).
    if (runningRef.current || permPromptRef.current) {
      pendingUpdateRef.current = info;
      return;
    }
    pendingUpdateRef.current = null;
    setUpdateInstaller(detectInstaller());
    setUpdatePhase('ask');
    setUpdateError(undefined);
    setUpdateInfo(info);
  }, []);

  const startUpdateCheck = useCallback((force = false) => {
    void checkForUpdate({ force }).then((info) => {
      if (!info) {
        if (force) {
          setStaticItems((prev) => [
            ...prev,
            { type: 'system', id: nextId(), text: '✓ maniac is up to date', variant: 'success' },
          ]);
        }
        return;
      }
      presentUpdateIfIdle(info);
    });
  }, [presentUpdateIfIdle]);

  useEffect(() => {
    if (process.env.MANIAC_SKIP_UPDATE === '1') return;
    // Wait until first-boot wizard is out of the way.
    if (showModelWizard) return;
    startUpdateCheck(false);
  }, [showModelWizard, startUpdateCheck]);

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
  // Synchronous run lock — React's isLoading state lags one commit behind,
  // so submit + drain must gate on this ref to avoid concurrent doRun calls.
  const runningRef = useRef(false);

  // Show deferred update prompt only when idle (no run / permission ask).
  useEffect(() => {
    if (!pendingUpdateRef.current) return;
    if (isLoading || permPrompt || showModelWizard || runningRef.current || updateInfo) return;
    const info = pendingUpdateRef.current;
    pendingUpdateRef.current = null;
    presentUpdateIfIdle(info);
  }, [isLoading, permPrompt, showModelWizard, updateInfo, presentUpdateIfIdle]);

  const abortCurrentRun = useCallback((announce = true) => {
    abortRef.current.aborted = true;
    abortControllerRef.current?.abort();
    // Do NOT clear runningRef / isLoading here — the in-flight doRun must keep
    // the lock until harness.run returns and clearLive runs. Releasing early
    // lets the queue drain (or a new submit) start a second concurrent run.
    setLiveText('');
    setStreamTools([]);
    setStreamSubagents([]);
    setSubagentDispatchCount(0);
    if (permResolveRef.current) {
      permResolveRef.current('deny');
      permResolveRef.current = null;
      setPermPrompt(null);
    }
    if (announce) {
      setStaticItems((prev) => [
        ...prev,
        { type: 'system', id: nextId(), text: 'cancelled', variant: 'warn' },
      ]);
    }
  }, []);

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
      if (runningRef.current) return;
      runningRef.current = true;
      const abort = { aborted: false };
      abortRef.current = abort;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsLoading(true);
      setLiveText('');
      setLiveThinking('');
      setStreamTools([]);
      setStreamSubagents([]);
      setSubagentDispatchCount(0);

      let fullText = '';
      let cleanedText = '';
      let thinkingText = '';
      const tools: ToolCallView[] = [];
      const subagents: SubagentStatus[] = [];

      const stripToolMarkup = (text: string) =>
        text
          .replace(/\[TOOL:[\s\S]*$/gi, '')
          .replace(/\[?TOOL:[\w\/]+\]\s*[\s\S]*?\s*\[\/TOOL\]/gi, '')
          .trim();

      const clearLive = () => {
        runningRef.current = false;
        setIsLoading(false);
        setLiveText('');
        setLiveThinking('');
        setStreamTools([]);
        setStreamSubagents([]);
        setSubagentDispatchCount(0);
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
                // Grok-inspired thinking stream — show while working, not in transcript.
                thinkingText += event.content;
                setLiveThinking(thinkingText);
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
              case 'subagents_dispatch': {
                setSubagentDispatchCount(event.count);
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

      if (fullText.trim() || tools.length > 0 || subagents.length > 0) {
        setStaticItems((prev) => [
          ...prev,
          {
            type: 'assistant',
            id: nextId(),
            text: fullText,
            tools: [...tools],
            subagents: subagents.length > 0 ? [...subagents] : undefined,
          },
        ]);
      }
      if (thinkingText.trim()) {
        const tid = nextId();
        const entry = { id: tid, text: thinkingText.trim() };
        // Freeze into Static (no redraw ghosts). Latest kept for Ctrl+E expand.
        setStaticItems((prev) => {
          const last = prev[prev.length - 1];
          if (last?.type === 'thought' && last.text === entry.text) return prev;
          return [...prev, { type: 'thought' as const, id: tid, text: entry.text }];
        });
        latestThoughtRef.current = entry;
        setLatestThought(entry);
        setThoughtExpanded(false);
      }
      if (fullText.trim()) {
        setChatHistory((prev) => {
          const next = [...prev, { role: 'assistant' as const, content: fullText }];
          chatHistoryRef.current = next;
          return next;
        });
      }
      clearLive();
    },
    [requestPermission, sessionId],
  );

  /** Isolated Bugbot review — does not touch chatHistory / session. */
  const doSentinel = useCallback(
    async (scope: 'uncommitted' | 'branch') => {
      if (runningRef.current) return;
      runningRef.current = true;
      const abort = { aborted: false };
      abortRef.current = abort;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsLoading(true);
      setLiveText('');
      setLiveThinking('');
      setStreamTools([]);
      setStreamSubagents([]);
      setSubagentDispatchCount(0);
      setShowBanner(false);

      let fullText = '';
      let thinkingText = '';
      const tools: ToolCallView[] = [];

      const clearLive = () => {
        runningRef.current = false;
        setIsLoading(false);
        setLiveText('');
        setLiveThinking('');
        setStreamTools([]);
        setStreamSubagents([]);
        setSubagentDispatchCount(0);
        setPermPrompt(null);
      };

      setStaticItems((prev) => [
        ...prev,
        {
          type: 'system',
          id: nextId(),
          text: `◆ Sentinel · ${scope} · ${SENTINEL_MODEL}`,
          variant: 'info',
        },
      ]);

      try {
        const report = await runSentinelReview({
          cwd: process.cwd(),
          scope,
          signal: controller.signal,
          onEvent: (event: StreamEvent) => {
            if (abort.aborted) return;
            switch (event.type) {
              case 'token':
                fullText += event.content;
                setLiveText(fullText);
                break;
              case 'reasoning':
                thinkingText += event.content;
                setLiveThinking(thinkingText);
                break;
              case 'tool_start': {
                const tc: ToolCallView = { tool: event.tool, args: event.args, done: false };
                tools.push(tc);
                setStreamTools([...tools]);
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
              case 'error':
                fullText += `\n[error: ${event.message}]`;
                setLiveText(fullText);
                break;
            }
          },
        });

        if (abort.aborted) {
          clearLive();
          return;
        }

        const text = (fullText.trim() || report || '').trim();
        if (text || tools.length > 0) {
          setStaticItems((prev) => [
            ...prev,
            { type: 'assistant', id: nextId(), text: text || report, tools: [...tools] },
          ]);
        }
        if (thinkingText.trim()) {
          const tid = nextId();
          const entry = { id: tid, text: thinkingText.trim() };
          setStaticItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === 'thought' && last.text === entry.text) return prev;
            return [...prev, { type: 'thought' as const, id: tid, text: entry.text }];
          });
          latestThoughtRef.current = entry;
          setLatestThought(entry);
          setThoughtExpanded(false);
        }
      } catch (e: unknown) {
        if (!abort.aborted) {
          const msg = e instanceof Error ? e.message : String(e);
          setStaticItems((prev) => [
            ...prev,
            { type: 'system', id: nextId(), text: `✗ sentinel: ${msg}`, variant: 'error' },
          ]);
        }
      }
      clearLive();
    },
    [],
  );

  const drainQueue = useCallback(async () => {
    if (drainingRef.current || runningRef.current || isLoading) return;
    const next = globalPromptQueue.dequeue();
    syncQueue();
    if (!next) return;
    drainingRef.current = true;
    try {
      setStaticItems((prev) => [...prev, { type: 'user', id: nextId(), text: next.text }]);
      const hist = chatHistoryRef.current;
      const withUser = [...hist, { role: 'user' as const, content: next.text }];
      chatHistoryRef.current = withUser;
      setChatHistory(withUser);
      const queuedImages = resolveMessageImages(next.text, attachmentsRef.current);
      attachmentsRef.current = attachmentsRef.current.filter(
        (a) => !next.text.includes(a.placeholder),
      );
      await doRun(next.text, hist, cfgRef.current.mode, queuedImages);
    } finally {
      drainingRef.current = false;
      syncQueue();
      if (globalPromptQueue.size > 0 && !runningRef.current) void drainQueue();
    }
  }, [doRun, isLoading, syncQueue]);

  useEffect(() => {
    if (!isLoading && globalPromptQueue.size > 0) void drainQueue();
  }, [isLoading, drainQueue]);

  // Grabs an image from the clipboard and appends an [imageN] placeholder to
  // the input. Shared by Ctrl+V and /paste (terminals like Windows Terminal
  // intercept Ctrl+V for text paste, so the keypress may never reach us).
  const attachClipboardImage = useCallback((warnIfEmpty: boolean) => {
    const img = captureClipboardImage();
    if (!img) {
      if (warnIfEmpty) {
        setStaticItems((prev) => [
          ...prev,
          {
            type: 'system',
            id: nextId(),
            text: 'no image in clipboard (copy a screenshot first, or type the file path)',
            variant: 'warn',
          },
        ]);
      }
      return false;
    }
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
    return true;
  }, []);

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
          if (runningRef.current) abortCurrentRun(false);
          globalPromptQueue.clear();
          syncQueue();
          chatHistoryRef.current = [];
          setChatHistory([]);
          setSessionId(undefined);
          setStaticItems([]);
          latestThoughtRef.current = null;
          setLatestThought(null);
          setThoughtExpanded(false);
          setShowBanner(true);
          break;

        case 'compact': {
          const compressed = compressMessages(
            [{ role: 'system', content: '' }, ...chatHistory],
            CONTEXT_LIMIT,
          );
          const withoutSystem = compressed.filter((m) => m.role !== 'system');
          chatHistoryRef.current = withoutSystem;
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

        case 'update':
          if (runningRef.current || isLoading || permPromptRef.current) {
            setStaticItems((prev) => [
              ...prev,
              {
                type: 'system',
                id: nextId(),
                text: 'finish the current run / permission prompt before /update',
                variant: 'warn',
              },
            ]);
            break;
          }
          startUpdateCheck(true);
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
              chatHistoryRef.current = rec.messages;
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
              chatHistoryRef.current = rec.messages;
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

        case 'paste':
          attachClipboardImage(true);
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

        case 'sentinel': {
          if (runningRef.current) {
            setStaticItems((prev) => [
              ...prev,
              {
                type: 'system',
                id: nextId(),
                text: '✗ agent busy — wait or Esc, then /sentinel',
                variant: 'error',
              },
            ]);
            break;
          }
          const parsed = parseSentinelArg(arg);
          if (typeof parsed === 'object' && 'error' in parsed) {
            setStaticItems((prev) => [
              ...prev,
              { type: 'system', id: nextId(), text: parsed.error, variant: 'error' },
            ]);
            break;
          }
          void doSentinel(parsed);
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
    [chatHistory, exit, attachClipboardImage, syncQueue, abortCurrentRun, doSentinel, startUpdateCheck],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Windows terminals sometimes deliver Enter twice.
      if (submitLockRef.current) return;
      submitLockRef.current = true;
      setTimeout(() => {
        submitLockRef.current = false;
      }, 250);

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

      // Prefer the sync run lock over React's isLoading — it can lag one frame
      // behind doRun starting (esp. right after a queue drain dequeues).
      if (isLoading || runningRef.current || drainingRef.current) {
        globalPromptQueue.enqueue(trimmed);
        syncQueue();
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

      setStaticItems((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === 'user' && last.text === trimmed) return prev;
        return [...prev, { type: 'user', id: nextId(), text: trimmed }];
      });
      const newHistory = [...chatHistory, { role: 'user' as const, content: trimmed }];
      chatHistoryRef.current = newHistory;
      setChatHistory(newHistory);
      void doRun(trimmed, chatHistory, cfgRef.current.mode, images);
    },
    [chatHistory, handleSlash, doRun, isLoading, syncQueue],
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

    if (updateInfo) {
      if (updatePhase === 'installing') return;
      if (updatePhase === 'done') return;
      if (updatePhase === 'error') {
        dismissUpdate(false);
        return;
      }
      // ask
      if (key.escape) {
        dismissUpdate(false);
        return;
      }
      if (inputChar.toLowerCase() === 'n') {
        dismissUpdate(true);
        return;
      }
      if (inputChar.toLowerCase() === 'b') {
        setUpdateInstaller((prev) => (prev === 'npm' ? 'bun' : 'npm'));
        return;
      }
      if (inputChar.toLowerCase() === 'y' || key.return) {
        if (updateBusyRef.current || runningRef.current) return;
        updateBusyRef.current = true;
        setUpdatePhase('installing');
        const installer = updateInstaller;
        const target = updateInfo.latest;
        void runUpdate(installer, target).then((result) => {
          updateBusyRef.current = false;
          if (result.ok) {
            setUpdatePhase('done');
            setTimeout(() => {
              exit();
              setTimeout(() => process.exit(0), 80);
            }, 1200);
          } else {
            setUpdateError(result.output || 'unknown error');
            setUpdatePhase('error');
          }
        });
        return;
      }
      return;
    }

    const cancelRun = () => abortCurrentRun(true);

    if (key.ctrl && inputChar === 'c') {
      if (isLoading || runningRef.current) {
        cancelRun();
        return;
      }
      saveCliConfig(cfgRef.current);
      exit();
      return;
    }

    // Esc cancels the current run (Grok/Claude-style interrupt)
    if (key.escape && (isLoading || runningRef.current) && !permPrompt) {
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

    // Ctrl+V / Alt+V → attach image from clipboard as [imageN].
    // Alt+V exists because Windows Terminal binds Ctrl+V to text paste and
    // the app never receives the keypress.
    if ((key.ctrl || key.meta) && inputChar === 'v') {
      const attached = attachClipboardImage(Boolean(key.meta));
      // Only consume the key when we attached an image (or Alt+V, which is
      // explicitly an image shortcut). Otherwise fall through so a lone 'v'
      // isn't typed — but we still return to avoid inserting the letter.
      if (attached || key.meta) return;
      return;
    }

    // Ctrl+E → expand/collapse most recent thought (full text in mutable panel)
    if (key.ctrl && inputChar === 'e') {
      if (!latestThoughtRef.current) return;
      setThoughtExpanded((v) => !v);
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

  // Live UI (tools + streaming text + queue) must fit above the footer so the
  // terminal doesn't scroll under the chat — that jitter breaks Ink redraws.
  const FOOTER_RESERVE = 7;
  const liveCap = Math.max(4, rows - FOOTER_RESERVE);
  const queueLines =
    queueEntries.length > 0 ? Math.min(4, 1 + Math.min(3, queueEntries.length) + (queueEntries.length > 3 ? 1 : 0)) : 0;
  const toolCap = Math.min(5, Math.max(2, Math.floor((liveCap - queueLines) / 2)));
  const textCap = Math.max(2, liveCap - toolCap - queueLines);
  const displayLiveText = clipToLastLines(liveText, textCap);

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

  if (updateInfo && !permPrompt) {
    return (
      <Box flexDirection="column">
        <UpdateOverlay
          current={updateInfo.current}
          latest={updateInfo.latest}
          installer={updateInstaller}
          phase={updatePhase}
          error={updateError}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Static key={staticEpoch} items={staticItems}>
        {(item: StaticItem) => (
          <Box
            key={item.id}
            // Prefer live stdout columns via ref so resize state churn does not
            // couple into Static item identity more than necessary.
            width={colsRef.current}
          >
            <MessageItem item={item} />
          </Box>
        )}
      </Static>

      {thoughtExpanded && latestThought ? (
        <ExpandableThought entry={latestThought} expanded />
      ) : latestThought ? (
        <Box paddingLeft={2} marginBottom={0}>
          <Text dimColor>ctrl+e expand last thought</Text>
        </Box>
      ) : null}

      {showBanner && !isLoading && <Banner />}

      {isLoading && (
        <LiveArea
          tools={streamTools}
          subagents={streamSubagents}
          dispatchCount={subagentDispatchCount}
          maxLines={toolCap}
          spinnerFrame={spinnerFrame}
          thinking={liveThinking}
        />
      )}

      {isLoading && displayLiveText ? (
        <Box paddingLeft={2} paddingRight={2} width={cols} flexShrink={0}>
          <Box flexShrink={0}>
            <Text dimColor>maniac  </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text>
              {renderMarkdown(displayLiveText)}
              {cursorVisible ? <Text color={ACCENT}>▌</Text> : <Text> </Text>}
            </Text>
          </Box>
        </Box>
      ) : null}

      {permPrompt && <PermissionOverlay prompt={permPrompt} />}

      {!permPrompt && slashMatches && (
        <SlashMenu commands={slashMatches} selected={Math.min(slashSelected, slashMatches.length - 1)} />
      )}

      <QueuePanel entries={queueEntries} />

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
        queueSize={queueEntries.length}
        sessionId={sessionId}
      />
      {/* Leave one blank row so Ink rarely hits exact fullscreen height on Windows
          (that path leaves stale frame copies on every spinner tick). */}
      <Text> </Text>
    </Box>
  );
}
