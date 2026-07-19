import React from 'react';
import { Box, Text } from 'ink';
import { ACCENT } from '../theme.js';
import type { ToolCallView } from '../ui-types.js';

/** Friendly verbs instead of raw tool names: [while running, when done]. */
const TOOL_VERBS: Record<string, [string, string]> = {
  ls: ['Searching', 'Searched'],
  glob: ['Searching', 'Searched'],
  grep: ['Searching', 'Searched'],
  read: ['Reading', 'Read'],
  write: ['Writing', 'Wrote'],
  edit: ['Editing', 'Edited'],
  source_edit: ['Editing', 'Edited'],
  system_prompt_edit: ['Editing', 'Edited'],
  exec: ['Running', 'Ran'],
  http_request: ['Fetching', 'Fetched'],
  spawn_terminal: ['Launching', 'Launched'],
  rebuild_engine: ['Rebuilding', 'Rebuilt'],
  model_switch: ['Switching', 'Switched'],
  memory_save: ['Remembering', 'Remembered'],
  memory_read: ['Recalling', 'Recalled'],
  profile_save: ['Remembering', 'Remembered'],
  skill_view: ['Reading', 'Read'],
  skill_create: ['Creating', 'Created'],
  tool_create: ['Creating', 'Created'],
  curator_run: ['Tidying', 'Tidied'],
  curator_status: ['Checking', 'Checked'],
  custom_tools_list: ['Checking', 'Checked'],
  delegate: ['Delegating', 'Delegated'],
  vision: ['Looking', 'Looked'],
  send_telegram: ['Messaging', 'Messaged'],
  telegram_list_chats: ['Checking', 'Checked'],
  server_start: ['Starting', 'Started'],
  server_status: ['Checking', 'Checked'],
  self_restart: ['Restarting', 'Restarted'],
};

function toolVerb(tool: string, done: boolean): string {
  const pair = TOOL_VERBS[tool];
  if (pair) return done ? pair[1] : pair[0];
  // MCP tools look like "server/tool_name"
  if (tool.includes('/')) return done ? 'Called' : 'Calling';
  return done ? 'Worked' : 'Working';
}

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
  const verb = toolVerb(tc.tool, tc.done);
  const label = formatToolArgs(tc.tool, tc.args);
  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          {'    '}
          {tc.done ? (
            <Text color={tc.success ? undefined : 'red'} dimColor={tc.success}>
              {tc.success ? '✓' : '✗'}
            </Text>
          ) : (
            <Text color={ACCENT}>✻</Text>
          )}
          {'  '}
          <Text dimColor={tc.done}>{verb}</Text>
          {label ? <Text dimColor>{'  '}{label}</Text> : null}
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
