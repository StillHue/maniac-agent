import React from 'react';
import { Box, Text } from 'ink';
import { ACCENT, AGENT, FAIL, MUTED, OK } from '../theme.js';
import type { SubagentStatus } from '../ui-types.js';

function statusGlyph(sub: SubagentStatus, spinnerFrame?: string): React.ReactNode {
  if (!sub.done) return <Text color={AGENT}>{spinnerFrame || '⠋'}</Text>;
  if (sub.success) return <Text color={OK}>✓</Text>;
  return <Text color={FAIL}>✗</Text>;
}

export function SubagentLine({
  sub,
  spinnerFrame,
}: {
  sub: SubagentStatus;
  spinnerFrame?: string;
}) {
  const goal = sub.goal.length > 42 ? `${sub.goal.slice(0, 39)}…` : sub.goal;
  const detail = sub.done
    ? (sub.tokenSnippet || '').replace(/\s+/g, ' ').trim().slice(0, 48)
    : sub.lastTool
      ? `tool:${sub.lastTool}`
      : (sub.tokenSnippet || '').replace(/\s+/g, ' ').trim().slice(-40) || '…';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={MUTED}>{'  │ '}</Text>
        {statusGlyph(sub, spinnerFrame)}
        <Text color={AGENT}>{' agent  '}</Text>
        <Text>{goal}</Text>
      </Box>
      {detail ? (
        <Box>
          <Text color={MUTED}>{'  │     '}</Text>
          <Text dimColor>{detail}{detail.length >= 48 ? '…' : ''}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function SubagentSection({
  subagents,
  dispatchCount,
  spinnerFrame,
  live,
}: {
  subagents: SubagentStatus[];
  dispatchCount?: number;
  spinnerFrame?: string;
  live?: boolean;
}) {
  if (subagents.length === 0 && !(dispatchCount && dispatchCount > 0)) return null;

  const active = subagents.filter((s) => !s.done).length;
  const done = subagents.filter((s) => s.done).length;
  const total = Math.max(dispatchCount || 0, subagents.length);
  const title = live
    ? active > 0
      ? `agents  ·  ${active}/${total} active`
      : `agents  ·  ${done}/${total} done`
    : `agents  ·  ${subagents.length}`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={MUTED}>{'  ┌ '}</Text>
        <Text color={AGENT} bold>
          {title}
        </Text>
        {live && active > 0 ? <Text color={ACCENT}>{`  ${spinnerFrame || '·'}`}</Text> : null}
      </Box>
      {subagents.map((sub) => (
        <SubagentLine key={sub.id} sub={sub} spinnerFrame={spinnerFrame} />
      ))}
      <Box>
        <Text color={MUTED}>{'  └─'}</Text>
      </Box>
    </Box>
  );
}
