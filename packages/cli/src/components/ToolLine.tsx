import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCallView } from '../ui-types.js';

const TOOL_ICONS: Record<string, string> = {
  read: '○',
  write: '◇',
  edit: '◈',
  ls: '◉',
  glob: '◎',
  grep: '◎',
  exec: '▶',
  source_edit: '◈',
  rebuild_engine: '▶',
  model_switch: '◉',
  memory_save: '◇',
  memory_read: '○',
  profile_save: '◇',
  delegate: '◆',
  send_telegram: '◇',
  spawn_terminal: '▶',
  server_start: '▶',
  server_status: '○',
  self_restart: '▶',
};

export function formatToolArgs(tool: string, args: unknown): string {
  const raw = typeof args === 'string' ? args : JSON.stringify(args ?? '');
  if (['read', 'write', 'edit', 'source_edit'].includes(tool)) {
    const firstLine = raw.split('\n')[0].trim();
    return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
  }
  if (tool === 'exec') {
    const cmd = raw.trim();
    return cmd.length > 70 ? cmd.slice(0, 67) + '…' : cmd;
  }
  if (tool === 'delegate') {
    const goal = raw.split('|')[0].trim();
    return goal.length > 60 ? goal.slice(0, 57) + '…' : goal;
  }
  return raw.length > 70 ? raw.slice(0, 67) + '…' : raw;
}

export function ToolLine({ tc, showOutput }: { tc: ToolCallView; showOutput?: boolean }) {
  const baseIcon = TOOL_ICONS[tc.tool] ?? '○';
  const icon = tc.done ? (tc.success ? '✓' : '✗') : baseIcon;
  const label = formatToolArgs(tc.tool, tc.args);
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>
          {'    '}
          {icon}  {tc.tool}  {label}
        </Text>
      </Box>
      {showOutput && tc.done && tc.output ? (
        <Box paddingLeft={6}>
          <Text dimColor>
            {tc.output.replace(/\s+/g, ' ').trim().slice(0, 100)}
            {tc.output.length > 100 ? '…' : ''}
          </Text>
        </Box>
      ) : null}
      {!tc.done && tc.output ? (
        <Box paddingLeft={6}>
          <Text dimColor>{tc.output.replace(/\s+/g, ' ').trim().slice(-80)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
