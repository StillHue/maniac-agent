import React from 'react';
import { Box, Text } from 'ink';
import { ToolLine } from './ToolLine.js';
import type { SubagentStatus, ToolCallView } from '../ui-types.js';

function SubagentLine({ sub }: { sub: SubagentStatus }) {
  const icon = sub.done ? (sub.success ? '✓' : '✗') : '◆';
  const snippet = sub.tokenSnippet
    ? sub.tokenSnippet.replace(/\s+/g, ' ').trim().slice(-55)
    : sub.lastTool
      ? sub.lastTool
      : '...';
  const goal = sub.goal.slice(0, 35) + (sub.goal.length > 35 ? '…' : '');
  return (
    <Box>
      <Text dimColor>
        {'    '}
        {icon}  agent  {goal}  {snippet}
      </Text>
    </Box>
  );
}

export function LiveArea({
  tools,
  subagents,
  rows,
}: {
  tools: ToolCallView[];
  subagents: SubagentStatus[];
  rows: number;
}) {
  if (tools.length === 0 && subagents.length === 0) return null;

  const budget = Math.max(3, rows - 6);
  const all: Array<{ kind: 'tool'; tc: ToolCallView } | { kind: 'sub'; sub: SubagentStatus }> = [
    ...tools.map((tc) => ({ kind: 'tool' as const, tc })),
    ...subagents.map((sub) => ({ kind: 'sub' as const, sub })),
  ];
  const visible = all.slice(-budget);
  const clipped = all.length > budget;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2}>
      {clipped && (
        <Box>
          <Text dimColor>
            {'  '}… {all.length - budget} earlier steps
          </Text>
        </Box>
      )}
      {visible.map((item, i) =>
        item.kind === 'tool' ? <ToolLine key={i} tc={item.tc} /> : <SubagentLine key={i} sub={item.sub} />,
      )}
    </Box>
  );
}
