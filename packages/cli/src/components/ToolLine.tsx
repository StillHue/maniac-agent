import React from 'react';
import { Box, Text } from 'ink';
import { ACCENT, FAIL, MUTED, OK, TOOL } from '../theme.js';
import type { ToolCallView } from '../ui-types.js';

const TOOL_VERBS: Record<string, [string, string]> = {
  ls: ['search', 'searched'],
  glob: ['search', 'searched'],
  grep: ['search', 'searched'],
  read: ['read', 'read'],
  write: ['write', 'wrote'],
  edit: ['edit', 'edited'],
  source_edit: ['edit', 'edited'],
  system_prompt_edit: ['edit', 'edited'],
  exec: ['exec', 'ran'],
  http_request: ['http', 'fetched'],
  spawn_terminal: ['spawn', 'spawned'],
  rebuild_engine: ['rebuild', 'rebuilt'],
  model_switch: ['model', 'switched'],
  memory_save: ['memory', 'saved'],
  memory_read: ['memory', 'recalled'],
  profile_save: ['profile', 'saved'],
  skill_view: ['skill', 'read'],
  skill_create: ['skill', 'created'],
  tool_create: ['tool', 'created'],
  curator_run: ['curator', 'ran'],
  curator_status: ['curator', 'checked'],
  custom_tools_list: ['tools', 'listed'],
  delegate: ['delegate', 'delegated'],
  vision: ['vision', 'saw'],
  send_telegram: ['telegram', 'sent'],
  telegram_list_chats: ['telegram', 'listed'],
  server_start: ['server', 'started'],
  server_status: ['server', 'checked'],
  self_restart: ['restart', 'restarted'],
  apply_patch: ['patch', 'patched'],
};

function toolLabel(tool: string, done: boolean): string {
  const pair = TOOL_VERBS[tool];
  if (pair) return done ? pair[1] : pair[0];
  if (tool.includes('/')) return done ? 'called' : 'call';
  return done ? 'done' : 'run';
}

export function formatToolArgs(tool: string, args: unknown): string {
  const raw = typeof args === 'string' ? args : JSON.stringify(args ?? '');
  if (['read', 'write', 'edit', 'source_edit', 'apply_patch'].includes(tool)) {
    const firstLine = raw.split('\n')[0].trim();
    return firstLine.length > 56 ? `${firstLine.slice(0, 53)}…` : firstLine;
  }
  if (tool === 'exec') {
    const cmd = raw.trim();
    return cmd.length > 64 ? `${cmd.slice(0, 61)}…` : cmd;
  }
  if (tool === 'delegate') {
    const goal = raw.split('|')[0].trim();
    return goal.length > 56 ? `${goal.slice(0, 53)}…` : goal;
  }
  return raw.length > 64 ? `${raw.slice(0, 61)}…` : raw;
}

function statusGlyph(tc: ToolCallView, spinnerFrame?: string): React.ReactNode {
  if (!tc.done) {
    return <Text color={TOOL}>{spinnerFrame || '⠋'}</Text>;
  }
  if (tc.success) return <Text color={OK}>✓</Text>;
  return <Text color={FAIL}>✗</Text>;
}

export function ToolLine({
  tc,
  showOutput,
  spinnerFrame,
}: {
  tc: ToolCallView;
  showOutput?: boolean;
  spinnerFrame?: string;
}) {
  const verb = toolLabel(tc.tool, tc.done);
  const label = formatToolArgs(tc.tool, tc.args);
  const name = tc.tool.includes('/') ? tc.tool.split('/').pop() || tc.tool : tc.tool;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text color={MUTED}>{'  │ '}</Text>
        {statusGlyph(tc, spinnerFrame)}
        <Text color={TOOL}>{` ${name.padEnd(10).slice(0, 10)}`}</Text>
        <Text dimColor>{` ${verb}`}</Text>
        {label ? <Text dimColor>{`  ${label}`}</Text> : null}
      </Box>
      {showOutput && tc.done && tc.output ? (
        <Box>
          <Text color={MUTED}>{'  │   '}</Text>
          <Text dimColor>
            {tc.output.replace(/\s+/g, ' ').trim().slice(0, 88)}
            {tc.output.length > 88 ? '…' : ''}
          </Text>
        </Box>
      ) : null}
      {!tc.done && tc.output ? (
        <Box>
          <Text color={MUTED}>{'  │   '}</Text>
          <Text dimColor>{tc.output.replace(/\s+/g, ' ').trim().slice(-72)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function ToolSection({
  tools,
  showOutput,
  spinnerFrame,
  live,
}: {
  tools: ToolCallView[];
  showOutput?: boolean;
  spinnerFrame?: string;
  live?: boolean;
}) {
  if (tools.length === 0) return null;
  const pending = tools.filter((t) => !t.done).length;
  const failed = tools.filter((t) => t.done && !t.success).length;
  const title = live
    ? pending > 0
      ? `tools  ·  ${pending} running`
      : `tools  ·  ${tools.length}`
    : `tools  ·  ${tools.length}${failed ? `  ·  ${failed} failed` : ''}`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={MUTED}>{'  ┌ '}</Text>
        <Text color={TOOL} bold>
          {title}
        </Text>
      </Box>
      {tools.map((tc, i) => (
        <ToolLine key={i} tc={tc} showOutput={showOutput} spinnerFrame={spinnerFrame} />
      ))}
      <Box>
        <Text color={MUTED}>{'  └'}</Text>
        {live && pending > 0 ? (
          <Text color={ACCENT}>{` ${spinnerFrame || '·'} working`}</Text>
        ) : (
          <Text color={MUTED}>{'─'}</Text>
        )}
      </Box>
    </Box>
  );
}
