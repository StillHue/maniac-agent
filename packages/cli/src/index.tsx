#!/usr/bin/env node

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { render, Box, Text, Static, useInput, useApp, type Key } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { runEngine, loadManiacConfig, saveManiacConfig, fetchModels, PROVIDER_DEFS } from '@maniac/engine';
import type { ManiacConfig, ProviderDef } from '@maniac/engine';
import type { ChatMessage, StreamEvent } from '@maniac/types';

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(os.homedir(), '.maniac-cli.json');
const HISTORY_FILE = path.join(os.homedir(), '.maniac-cli-history');

interface Config {
  mode: 'chat' | 'ask' | 'plan';
}

function defaultConfig(): Config {
  return { mode: 'chat' };
}

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch {}
  return defaultConfig();
}

function saveConfig(c: Config): void {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); } catch {}
}

// ─── Command history ────────────────────────────────────────────────────────

function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    }
  } catch {}
  return [];
}

function appendHistory(line: string): void {
  try { fs.appendFileSync(HISTORY_FILE, line + '\n'); } catch {}
}

// ─── Git info ───────────────────────────────────────────────────────────────

interface GitInfo {
  repo: string;
  branch: string;
}

function getGitInfo(): GitInfo {
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const repo = path.basename(toplevel);
    const branch = execSync('git branch --show-current', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'HEAD';
    return { repo, branch };
  } catch {
    return { repo: 'maniac', branch: '' };
  }
}

// ─── Token estimation ───────────────────────────────────────────────────────

const MAX_TOKENS = 128000;

function estimateTokens(msgs: ChatMessage[]): number {
  return msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

// ─── Markdown rendering (ANSI strings) ─────────────────────────────────────

const ANSI_RESET  = '\x1b[0m';
const ANSI_BOLD   = '\x1b[1m';
const ANSI_DIM    = '\x1b[38;5;245m';
const ANSI_RED    = '\x1b[38;5;203m';

function renderMarkdown(text: string): string {
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) =>
      `\n${ANSI_DIM}${ANSI_BOLD}▌${ANSI_RESET}${ANSI_DIM} ${lang || 'code'}${ANSI_RESET}\n${ANSI_DIM}${code.trimEnd()}${ANSI_RESET}\n`)
    .replace(/`([^`]+)`/g, `${ANSI_DIM}$1${ANSI_RESET}`)
    .replace(/\*\*(.+?)\*\*/g, `${ANSI_BOLD}$1${ANSI_RESET}`)
    .replace(/\*(.+?)\*/g, `${ANSI_DIM}$1${ANSI_RESET}`)
    .replace(/^#{1,3} (.+)$/gm, `${ANSI_BOLD}${ANSI_RED}$1${ANSI_RESET}`)
    .replace(/^[-*] (.+)$/gm, `  ${ANSI_DIM}•${ANSI_RESET} $1`)
    .replace(/^\d+\. (.+)$/gm, `  ${ANSI_DIM}›${ANSI_RESET} $1`);
}

// ─── Static message types ───────────────────────────────────────────────────

interface ToolCall {
  tool: string;
  args: unknown;
  done: boolean;
  success?: boolean;
}

interface SubagentStatus {
  id: string;
  goal: string;
  done: boolean;
  success?: boolean;
  lastTool?: string;
  tokenSnippet: string;
}

type StaticItem =
  | { type: 'banner' }
  | { type: 'user'; id: number; text: string }
  | { type: 'assistant'; id: number; text: string; tools: ToolCall[] }
  | { type: 'system'; id: number; text: string; variant: 'info' | 'error' | 'success' | 'warn' };

// ─── ContextBar component ───────────────────────────────────────────────────

function ContextBar({ used, max }: { used: number; max: number }) {
  const pct = Math.min(1, used / max);
  const bars = 12;
  const filled = Math.round(pct * bars);
  const bar = '█'.repeat(filled) + '░'.repeat(bars - filled);
  const pctInt = Math.round(pct * 100);
  const color = pct > 0.85 ? 'white' : pct > 0.65 ? 'gray' : 'gray';
  return <Text color={color}>[{bar}] {pctInt}% ctx</Text>;
}

// ─── ToolLine component ─────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  read: '○', write: '◇', edit: '◈', ls: '◉', glob: '◎', grep: '◎',
  exec: '▶', source_edit: '◈', rebuild_engine: '▶', model_switch: '◉',
  memory_save: '◇', memory_read: '○', profile_save: '◇',
  delegate: '◆', send_telegram: '◇', spawn_terminal: '▶',
  server_start: '▶', server_status: '○', self_restart: '▶',
};

function formatToolArgs(tool: string, args: unknown): string {
  const raw = typeof args === 'string' ? args : JSON.stringify(args ?? '');
  // For file ops show only the filename/path, not content
  if (['read', 'write', 'edit', 'source_edit'].includes(tool)) {
    const firstLine = raw.split('\n')[0].trim();
    return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
  }
  // For exec show the command truncated
  if (tool === 'exec') {
    const cmd = raw.trim();
    return cmd.length > 70 ? cmd.slice(0, 67) + '…' : cmd;
  }
  // For delegate show the goal
  if (tool === 'delegate') {
    const goal = raw.split('|')[0].trim();
    return goal.length > 60 ? goal.slice(0, 57) + '…' : goal;
  }
  return raw.length > 70 ? raw.slice(0, 67) + '…' : raw;
}

function ToolLine({ tc }: { tc: ToolCall }) {
  const baseIcon = TOOL_ICONS[tc.tool] ?? '○';
  const icon = tc.done
    ? (tc.success ? '✓' : '✗')
    : baseIcon;
  const label = formatToolArgs(tc.tool, tc.args);
  return (
    <Box>
      <Text dimColor>    {icon}  {tc.tool}  {label}</Text>
    </Box>
  );
}

// ─── Banner ─────────────────────────────────────────────────────────────────

// Each line uses block-drawing chars that form the letter outlines.
// The "fill" chars (█) are white; the "outline/corner" chars are dim gray.
// Width of the widest line: 50 chars.
const MANIAC_ASCII_WIDTH = 50;

// Split each line into segments: { text, bright: boolean }[]
// Bright = solid block █  ║  ═  ╗  ╝  ╔  ╚
// Dim    = everything else (╗ ╔ ╝ ╚ ╠ ╣ ╦ ╩ ╬ ─ │ corners, spaces)
function splitAsciiLine(line: string): { text: string; bright: boolean }[] {
  const segments: { text: string; bright: boolean }[] = [];
  let cur = '';
  let curBright: boolean | null = null;

  for (const ch of line) {
    const bright = ch === '█';
    if (curBright === null) curBright = bright;
    if (bright !== curBright) {
      if (cur) segments.push({ text: cur, bright: curBright });
      cur = ch;
      curBright = bright;
    } else {
      cur += ch;
    }
  }
  if (cur) segments.push({ text: cur, bright: curBright! });
  return segments;
}

const MANIAC_ASCII = [
  '███╗   ███╗ █████╗ ███╗   ██╗██╗ █████╗  ██████╗',
  '████╗ ████║██╔══██╗████╗  ██║██║██╔══██╗██╔════╝',
  '██╔████╔██║███████║██╔██╗ ██║██║███████║██║     ',
  '██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══██║██║     ',
  '██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║  ██║╚██████╗',
  '╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝  ╚═╝ ╚═════╝',
];

function Banner() {
  const cols = process.stdout.columns || 80;
  const pad = Math.max(0, Math.floor((cols - MANIAC_ASCII_WIDTH) / 2));
  const paddingLeft = pad;

  const subtitle = 'the what the hell agent for your maniac ideas  ·  /help';
  const subPad = Math.max(0, Math.floor((cols - subtitle.length) / 2));

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text> </Text>
      {MANIAC_ASCII.map((line, i) => (
        <Box key={i} paddingLeft={paddingLeft}>
          {splitAsciiLine(line).map((seg, j) => (
            <Text key={j} color={seg.bright ? 'white' : undefined} dimColor={!seg.bright}>
              {seg.text}
            </Text>
          ))}
        </Box>
      ))}
      <Text> </Text>
      <Box paddingLeft={subPad}>
        <Text dimColor>{subtitle}</Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}

// ─── MessageItem component ──────────────────────────────────────────────────

function MessageItem({ item }: { item: StaticItem }) {
  if (item.type === 'banner') return <Banner />;

  if (item.type === 'user') {
    return (
      <Box paddingLeft={2} paddingRight={2} marginBottom={1}>
        <Text dimColor>you  </Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }

  if (item.type === 'assistant') {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} marginBottom={1}>
        {item.tools.map((tc, i) => <ToolLine key={i} tc={tc} />)}
        {item.text ? (
          <Box marginTop={item.tools.length > 0 ? 1 : 0}>
            <Text dimColor>maniac  </Text>
            <Text>{renderMarkdown(item.text)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  if (item.type === 'system') {
    return (
      <Box paddingLeft={2} marginBottom={1}>
        <Text dimColor>{item.text}</Text>
      </Box>
    );
  }

  return null;
}

// ─── StreamingMessage component ─────────────────────────────────────────────

const MANIAC_THINKING = [
  'It makes sense?',
  'What the hell is that...',
  'Investigating btw',
  'Hold on, this is interesting',
  'Processing your madness',
  'Let me think about this...',
  'Connecting the dots',
  'Something is off here',
  'On it, don\'t panic',
  'This is actually wild',
  'Reading between the lines',
  'Running the numbers',
];

let thinkingIdx = 0;

function SubagentLine({ sub }: { sub: SubagentStatus }) {
  const icon = sub.done ? (sub.success ? '✓' : '✗') : '◆';
  const snippet = sub.tokenSnippet
    ? sub.tokenSnippet.replace(/\s+/g, ' ').trim().slice(-55)
    : (sub.lastTool ? sub.lastTool : '...');
  const goal = sub.goal.slice(0, 35) + (sub.goal.length > 35 ? '…' : '');
  return (
    <Box>
      <Text dimColor>    {icon}  agent  {goal}  {snippet}</Text>
    </Box>
  );
}

// LiveArea: the live tool/subagent view while the engine runs.
// Capped to avoid pushing the footer off screen — Ink has no native scroll,
// so we cap the number of visible rows and show only the most recent entries.
function LiveArea({ tools, subagents, rows }: {
  tools: ToolCall[];
  subagents: SubagentStatus[];
  rows: number;
}) {
  if (tools.length === 0 && subagents.length === 0) return null;

  // Each entry is 1 line. Reserve rows for footer (4) + separator (1) + margin (1) = 6.
  const budget = Math.max(3, rows - 6);

  // Build a flat list of items, most recent last
  const all: Array<{ kind: 'tool'; tc: ToolCall } | { kind: 'sub'; sub: SubagentStatus }> = [
    ...tools.map(tc => ({ kind: 'tool' as const, tc })),
    ...subagents.map(sub => ({ kind: 'sub' as const, sub })),
  ];

  // Show only the last `budget` entries so the footer stays on screen
  const visible = all.slice(-budget);
  const clipped = all.length > budget;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2}>
      {clipped && <Box><Text dimColor>  … {all.length - budget} earlier steps</Text></Box>}
      {visible.map((item, i) =>
        item.kind === 'tool'
          ? <ToolLine key={i} tc={item.tc} />
          : <SubagentLine key={i} sub={item.sub} />,
      )}
    </Box>
  );
}

function useThinkingPhrase(active: boolean): string {
  const [phrase, setPhrase] = useState(MANIAC_THINKING[0]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      thinkingIdx = (thinkingIdx + 1) % MANIAC_THINKING.length;
      setPhrase(MANIAC_THINKING[thinkingIdx]);
    }, 2200);
    return () => clearInterval(t);
  }, [active]);
  return phrase;
}

// ─── Footer component ───────────────────────────────────────────────────────

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

function Footer({
  git, tokens, mode, cols, value, cursorVisible, isLoading, spinnerFrame, thinkingPhrase, reasoningText, activeModel,
}: {
  git: GitInfo; tokens: number; mode: string; cols: number;
  value: string; cursorVisible: boolean; isLoading: boolean;
  spinnerFrame: string; thinkingPhrase: string; reasoningText: string; activeModel: string;
}) {
  const pct = Math.round(Math.min(1, tokens / MAX_TOKENS) * 100);
  const leftStatus = git.branch
    ? `${git.repo}(${git.branch})  ·  ${pct}% ctx  ·  ${mode}`
    : `${git.repo}  ·  ${pct}% ctx  ·  ${mode}`;
  const rightStatus = `● ${activeModel}`;
  const gap = Math.max(1, cols - 2 - leftStatus.length - rightStatus.length);

  // When the model is actively generating reasoning text, show it live.
  // Strip newlines so it fits in one line, truncate to available width.
  const maxReasoningWidth = Math.max(20, cols - 8);
  const liveText = reasoningText
    ? reasoningText.replace(/\s+/g, ' ').trim().slice(-maxReasoningWidth)
    : '';
  const displayText = isLoading
    ? (liveText || `${spinnerFrame} ${thinkingPhrase}`)
    : '';

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text dimColor>{'─'.repeat(cols)}</Text>

      <Box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <Text dimColor>{isLoading ? '  ' : '> '}</Text>
        {isLoading
          ? <Text dimColor>{displayText}</Text>
          : (
            <Text>
              {value}
              {cursorVisible ? <Text color="white">█</Text> : <Text> </Text>}
            </Text>
          )
        }
      </Box>

      <Box paddingLeft={2} paddingRight={2}>
        <Text dimColor>
          {leftStatus}
          {' '.repeat(gap)}
          {rightStatus}
        </Text>
      </Box>
    </Box>
  );
}

// ─── Help text ──────────────────────────────────────────────────────────────

const HELP_TEXT = `
Comandos disponíveis:

  /mode chat       muda para modo chat (conversa livre)
  /mode ask        muda para modo ask (resposta direta)
  /mode plan       muda para modo plan (planejamento)
  /model           configura provider e modelo de IA
  /clear           limpa o histórico de conversa
  /history         mostra o histórico da sessão atual
  /help            mostra esta ajuda
  /exit            sai

  ↑/↓  navega no histórico de comandos
`.trim();

// ─── ModelWizard ─────────────────────────────────────────────────────────────

type WizardStep = 'provider' | 'apikey' | 'baseurl' | 'models' | 'done';

interface ModelWizardProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
  isFirstBoot?: boolean;
}

// "Auto" is always the first entry in the wizard — no key needed, uses env vars / config slots
const AUTO_ENTRY = { id: 'auto', name: 'Auto (NVIDIA + OpenCode — no setup needed)', requiresKey: false, baseUrl: '', modelsEndpoint: '', chatEndpoint: '', authType: 'none' as const, format: 'openai' as const };
const WIZARD_PROVIDERS = [AUTO_ENTRY, ...PROVIDER_DEFS.filter(d => d.id !== 'auto')];

function ModelWizard({ onDone, onCancel, isFirstBoot }: ModelWizardProps) {
  const [step, setStep] = useState<WizardStep>('provider');
  const [providerIdx, setProviderIdx] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelIdx, setModelIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedDef = WIZARD_PROVIDERS[providerIdx];

  useInput((char, key) => {
    if (key.escape) { onCancel(); return; }

    if (step === 'provider') {
      if (key.upArrow) { setProviderIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setProviderIdx(i => Math.min(WIZARD_PROVIDERS.length - 1, i + 1)); return; }
      if (key.return) {
        if (selectedDef.id === 'auto') {
          saveManiacConfig({ provider: 'auto', model: 'auto', apiKey: '' });
          onDone('provider: Auto  model: auto');
          return;
        }
        if (selectedDef.id === 'custom') {
          setInputValue('');
          setStep('baseurl');
        } else if (!selectedDef.requiresKey) {
          setInputValue('');
          setStep('models');
          loadModels(selectedDef as ProviderDef, '', selectedDef.baseUrl);
        } else {
          setInputValue('');
          setStep('apikey');
        }
        return;
      }
    }

    if (step === 'apikey') {
      if (key.return) {
        const key_ = inputValue.trim();
        setApiKey(key_);
        setInputValue('');
        setStep('models');
        loadModels(selectedDef as ProviderDef, key_, selectedDef.baseUrl);
        return;
      }
      if (key.backspace || key.delete) { setInputValue(v => v.slice(0, -1)); return; }
      if (!key.ctrl && !key.meta && char) setInputValue(v => v + char);
      return;
    }

    if (step === 'baseurl') {
      if (key.return) {
        const url = inputValue.trim();
        setBaseUrl(url);
        setInputValue('');
        setStep('apikey');
        return;
      }
      if (key.backspace || key.delete) { setInputValue(v => v.slice(0, -1)); return; }
      if (!key.ctrl && !key.meta && char) setInputValue(v => v + char);
      return;
    }

    if (step === 'models') {
      if (loading) return;
      if (key.upArrow) { setModelIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelIdx(i => Math.min(models.length - 1, i + 1)); return; }
      if (key.return && models.length > 0) {
        const chosenModel = models[modelIdx];
        const cfg: ManiacConfig = {
          provider: selectedDef.id,
          model: chosenModel,
          apiKey: apiKey || '',
          baseUrl: baseUrl || undefined,
        };
        saveManiacConfig(cfg);
        onDone(`provider: ${selectedDef.name}  model: ${chosenModel}`);
        return;
      }
    }
  });

  async function loadModels(def: ProviderDef, key: string, bUrl: string) {
    setLoading(true);
    setError('');
    try {
      const list = await fetchModels(def, key, bUrl || undefined);
      setModels(list);
      setModelIdx(0);
    } catch (e: any) {
      setError(e.message);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }

  const PAGE = 12;
  const pageStart = Math.max(0, modelIdx - Math.floor(PAGE / 2));
  const pageEnd   = Math.min(models.length, pageStart + PAGE);

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {isFirstBoot
        ? <Text>welcome to maniac  <Text dimColor>— pick a provider to get started</Text></Text>
        : <Text dimColor>── model setup  (ESC to cancel) ───────────────────</Text>
      }
      <Text> </Text>

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text dimColor>select provider:</Text>
          {WIZARD_PROVIDERS.map((def, i) => (
            <Box key={def.id}>
              <Text color={i === providerIdx ? 'white' : undefined} dimColor={i !== providerIdx}>
                {i === providerIdx ? '› ' : '  '}{def.name}
              </Text>
            </Box>
          ))}
          <Text> </Text>
          <Text dimColor>↑/↓ navigate  · enter select</Text>
        </Box>
      )}

      {step === 'baseurl' && (
        <Box flexDirection="column">
          <Text dimColor>base URL (e.g. http://localhost:11434/v1):</Text>
          <Box paddingTop={1}>
            <Text dimColor>{'> '}</Text>
            <Text>{inputValue}█</Text>
          </Box>
        </Box>
      )}

      {step === 'apikey' && (
        <Box flexDirection="column">
          <Text dimColor>API key for {selectedDef.name}:</Text>
          <Box paddingTop={1}>
            <Text dimColor>{'> '}</Text>
            <Text dimColor>{'*'.repeat(inputValue.length)}█</Text>
          </Box>
          <Box paddingTop={1}>
            <Text dimColor>enter to confirm  (leave empty to skip)</Text>
          </Box>
        </Box>
      )}

      {step === 'models' && (
        <Box flexDirection="column">
          {loading && <Text dimColor>fetching models...</Text>}
          {error && <Text dimColor>error: {error}</Text>}
          {!loading && !error && models.length === 0 && <Text dimColor>no models found</Text>}
          {!loading && models.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor>select model  ({models.length} available):</Text>
              {models.slice(pageStart, pageEnd).map((m, i) => {
                const idx = pageStart + i;
                return (
                  <Box key={m}>
                    <Text color={idx === modelIdx ? 'white' : undefined} dimColor={idx !== modelIdx}>
                      {idx === modelIdx ? '› ' : '  '}{m}
                    </Text>
                  </Box>
                );
              })}
              <Text> </Text>
              <Text dimColor>↑/↓ navigate  · enter select</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

let _itemId = 1;
function nextId() { return _itemId++; }

function App() {
  const { exit } = useApp();

  const [cfg, setCfg] = useState<Config>(() => loadConfig());
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  const [staticItems, setStaticItems] = useState<StaticItem[]>([{ type: 'banner' }]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const [input, setInput] = useState('');
  const inputRef = useRef(input);
  useEffect(() => { inputRef.current = input; }, [input]);

  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setCursorVisible(v => !v), 500);
    return () => clearInterval(t);
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  // reasoningText: text the model generates before/between tool calls — shown only in footer
  const [reasoningText, setReasoningText] = useState('');
  const [streamTools, setStreamTools] = useState<ToolCall[]>([]);
  const [streamSubagents, setStreamSubagents] = useState<SubagentStatus[]>([]);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const [spinnerFrame, setSpinnerFrame] = useState(SPINNER_FRAMES[0]);
  const spinnerIdx = useRef(0);
  useEffect(() => {
    if (!isLoading) return;
    const t = setInterval(() => {
      spinnerIdx.current = (spinnerIdx.current + 1) % SPINNER_FRAMES.length;
      setSpinnerFrame(SPINNER_FRAMES[spinnerIdx.current]);
    }, 80);
    return () => clearInterval(t);
  }, [isLoading]);

  const [git, setGit] = useState<GitInfo>(() => getGitInfo());
  useEffect(() => {
    const t = setInterval(() => setGit(getGitInfo()), 5000);
    return () => clearInterval(t);
  }, []);

  const [activeModel, setActiveModel] = useState<string>(() => getActiveModelLabel());

  // Auto-open wizard on first boot: no config.json AND no env var keys present
  const isFirstBoot = useState<boolean>(() => {
    const cfg = loadManiacConfig();
    if (cfg) return false;
    return !(
      process.env.OPENCODE_API_KEY ||
      process.env.NVIDIA_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.MISTRAL_API_KEY
    );
  })[0];
  const [showModelWizard, setShowModelWizard] = useState<boolean>(isFirstBoot);

  const cmdHistory = useRef<string[]>(loadHistory());
  const historyIdx = useRef<number>(-1);
  const savedInput = useRef<string>('');

  // ── Engine call ───────────────────────────────────────────────────────────

  const doRun = useCallback(async (message: string, history: ChatMessage[], mode: string) => {
    const abort = { aborted: false };
    abortRef.current = abort;
    setIsLoading(true);
    setReasoningText('');
    setStreamTools([]);
    setStreamSubagents([]);

    let fullText = '';
    const tools: ToolCall[] = [];
    const subagents: SubagentStatus[] = [];
    // text accumulated since the last tool call — shown in footer; discarded when tool fires
    let pendingReasoning = '';

    const clearLive = () => {
      setIsLoading(false);
      setReasoningText('');
      setStreamTools([]);
      setStreamSubagents([]);
    };

    try {
      await runEngine({
        message,
        mode: mode as 'chat' | 'ask' | 'plan',
        history,
        onEvent: (event: StreamEvent) => {
          if (abort.aborted) return;

          switch (event.type) {
            case 'token': {
              fullText += event.content;
              // Strip tool syntax so only prose is accumulated
              pendingReasoning = fullText
                .replace(/\[TOOL:[\s\S]*$/gi, '')
                .replace(/\[?TOOL:[\w\/]+\]\s*[\s\S]*?\s*\[\/TOOL\]/gi, '')
                .trim();
              setReasoningText(pendingReasoning);
              break;
            }
            case 'reasoning': {
              if (!pendingReasoning) {
                pendingReasoning = event.content;
                setReasoningText(pendingReasoning);
              }
              break;
            }
            case 'tool_start': {
              // Text before this tool call was reasoning, not final reply
              fullText = '';
              pendingReasoning = '';
              setReasoningText('');
              const tc: ToolCall = { tool: event.tool, args: event.args, done: false };
              tools.push(tc);
              setStreamTools([...tools]);
              break;
            }
            case 'tool_result': {
              const tc = tools.find(t => t.tool === event.tool && !t.done);
              if (tc) { tc.done = true; tc.success = event.success; }
              setStreamTools([...tools]);
              break;
            }
            case 'subagent_start': {
              subagents.push({ id: event.id, goal: event.goal, done: false, tokenSnippet: '' });
              setStreamSubagents([...subagents]);
              break;
            }
            case 'subagent_token': {
              const sub = subagents.find(s => s.id === event.id);
              if (sub) { sub.tokenSnippet = event.content; }
              setStreamSubagents([...subagents]);
              break;
            }
            case 'subagent_tool': {
              const sub = subagents.find(s => s.id === event.id);
              if (sub) {
                if (!event.done) sub.lastTool = event.tool;
                else sub.tokenSnippet = '';
              }
              setStreamSubagents([...subagents]);
              break;
            }
            case 'subagent_done': {
              const sub = subagents.find(s => s.id === event.id);
              if (sub) { sub.done = true; sub.success = event.success; sub.tokenSnippet = event.summary.slice(0, 80); }
              setStreamSubagents([...subagents]);
              break;
            }
            case 'error': {
              fullText += `\n[erro: ${event.message}]`;
              pendingReasoning = fullText;
              setReasoningText(fullText);
              break;
            }
          }
        },
      });
    } catch (e: unknown) {
      if (abort.aborted) { clearLive(); return; }
      const msg = e instanceof Error ? e.message : String(e);
      setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: `✗ ${msg}`, variant: 'error' }]);
      clearLive();
      return;
    }

    if (abort.aborted) { clearLive(); return; }

    setStaticItems(prev => [
      ...prev,
      { type: 'assistant', id: nextId(), text: fullText, tools: [...tools] },
    ]);
    setChatHistory(prev => [...prev, { role: 'assistant', content: fullText }]);
    clearLive();
  }, []);

  // ── Slash commands ────────────────────────────────────────────────────────

  const handleSlash = useCallback((raw: string) => {
    const [cmd, ...rest] = raw.slice(1).split(' ');
    const arg = rest.join(' ').trim();

    switch (cmd.toLowerCase()) {
      case 'help':
        setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: HELP_TEXT, variant: 'info' }]);
        break;

      case 'exit':
      case 'quit':
        saveConfig(cfgRef.current);
        exit();
        break;

      case 'clear':
        setChatHistory([]);
        setStaticItems([{ type: 'banner' }]);
        break;

      case 'mode':
        if (['chat', 'ask', 'plan'].includes(arg)) {
          const newCfg = { ...cfgRef.current, mode: arg as Config['mode'] };
          setCfg(newCfg);
          saveConfig(newCfg);
          setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: `✓ modo: ${arg}`, variant: 'success' }]);
        } else {
          setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: '✗ modos válidos: chat, ask, plan', variant: 'error' }]);
        }
        break;

      case 'model':
        setShowModelWizard(true);
        break;

      case 'history':
        if (chatHistory.length === 0) {
          setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: 'histórico vazio', variant: 'info' }]);
        } else {
          const lines = chatHistory
            .map(m => `  ${m.role === 'user' ? 'você' : 'maniac'}  ${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}`)
            .join('\n');
          setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: lines, variant: 'info' }]);
        }
        break;

      default:
        setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: `comando desconhecido: /${cmd}  (use /help)`, variant: 'error' }]);
    }
  }, [chatHistory, exit]);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback((text: string) => {
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

    setStaticItems(prev => [...prev, { type: 'user', id: nextId(), text: trimmed }]);
    const newHistory = [...chatHistory, { role: 'user' as const, content: trimmed }];
    setChatHistory(newHistory);
    setInput('');

    void doRun(trimmed, chatHistory, cfgRef.current.mode);
  }, [chatHistory, handleSlash, doRun]);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useInput((inputChar: string, key: Key) => {
    if (key.ctrl && inputChar === 'c') {
      if (isLoading) {
        abortRef.current.aborted = true;
        setIsLoading(false);
        setReasoningText('');
        setStreamTools([]);
        setStreamSubagents([]);
        return;
      }
      saveConfig(cfgRef.current);
      exit();
      return;
    }

    if (showModelWizard) return;
    if (isLoading) return;

    if (key.return) {
      handleSubmit(inputRef.current);
      return;
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
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

    setInput(prev => prev + inputChar);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  const usedTokens = estimateTokens(chatHistory);
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 24;
  const thinkingPhrase = useThinkingPhrase(isLoading);

  if (showModelWizard) {
    return (
      <Box flexDirection="column">
        <ModelWizard
          onDone={(msg) => {
            setShowModelWizard(false);
            setActiveModel(getActiveModelLabel());
            setStaticItems(prev => [...prev, { type: 'system', id: nextId(), text: `✓ ${msg}`, variant: 'success' }]);
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
          <Box key={item.type === 'banner' ? 'banner' : (item as Extract<StaticItem, { id: number }>).id} width="100%">
            <MessageItem item={item} />
          </Box>
        )}
      </Static>

      {isLoading && (
        <LiveArea tools={streamTools} subagents={streamSubagents} rows={rows} />
      )}

      <Footer
        git={git}
        tokens={usedTokens}
        mode={cfg.mode}
        cols={cols}
        value={input}
        cursorVisible={cursorVisible}
        isLoading={isLoading}
        spinnerFrame={spinnerFrame}
        thinkingPhrase={thinkingPhrase}
        reasoningText={reasoningText}
        activeModel={activeModel}
      />
    </Box>
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

// Clear terminal before rendering so previous shell history is hidden
process.stdout.write('\x1b[2J\x1b[H');

render(<App />);
