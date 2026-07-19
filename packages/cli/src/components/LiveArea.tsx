import React from 'react';
import { Box, Text } from 'ink';
import { ToolLine } from './ToolLine.js';
import { ACCENT } from '../theme.js';
import type { SubagentStatus, ToolCallView } from '../ui-types.js';

function SubagentLine({
  sub,
  spinnerFrame,
}: {
  sub: SubagentStatus;
  spinnerFrame?: string;
}) {
  const icon = sub.done ? (sub.success ? '✓' : '✗') : spinnerFrame || '⠋';
  const snippet = sub.tokenSnippet
    ? sub.tokenSnippet.replace(/\s+/g, ' ').trim().slice(-55)
    : sub.lastTool
      ? sub.lastTool
      : '...';
  const goal = sub.goal.slice(0, 35) + (sub.goal.length > 35 ? '…' : '');
  return (
    <Box>
      <Text>
        {'    '}
        <Text color={sub.done ? undefined : ACCENT} dimColor={sub.done && !!sub.success}>
          {icon}
        </Text>
        <Text dimColor>
          {'  '}agent  {goal}  {snippet}
        </Text>
      </Text>
    </Box>
  );
}

export function LiveArea({
  tools,
  subagents,
  dispatchCount,
  maxLines,
  spinnerFrame,
}: {
  tools: ToolCallView[];
  subagents: SubagentStatus[];
  dispatchCount: number;
  /** Hard cap so this region never forces terminal scroll under the chat. */
  maxLines: number;
  spinnerFrame?: string;
}) {
  if (tools.length === 0 && subagents.length === 0 && dispatchCount <= 0) return null;

  const headerLines = dispatchCount > 0 ? 1 : 0;
  const budget = Math.max(1, maxLines - headerLines);
  const all: Array<{ kind: 'tool'; tc: ToolCallView } | { kind: 'sub'; sub: SubagentStatus }> = [
    ...tools.map((tc) => ({ kind: 'tool' as const, tc })),
    ...subagents.map((sub) => ({ kind: 'sub' as const, sub })),
  ];
  const clipped = all.length > budget;
  const visible = all.slice(-(clipped ? budget - 1 : budget));
  const active = subagents.filter((s) => !s.done).length;
  const done = subagents.filter((s) => s.done).length;
  const total = Math.max(dispatchCount, subagents.length);
  const showDispatch = total > 0;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} flexShrink={0}>
      {showDispatch && (
        <Box>
          <Text>
            <Text color={ACCENT}>{active > 0 ? `${spinnerFrame || '⠋'} ` : '◆ '}</Text>
            <Text color={ACCENT}>
              {active > 0
                ? `Dispatching ${total} subagent${total === 1 ? '' : 's'}`
                : `Dispatched ${total} subagent${total === 1 ? '' : 's'}`}
            </Text>
            {subagents.length > 0 && (
              <Text dimColor>
                {`  ·  ${done}/${total} done`}
              </Text>
            )}
          </Text>
        </Box>
      )}
      {clipped && (
        <Box>
          <Text dimColor>
            {'  '}… {all.length - visible.length} earlier steps
          </Text>
        </Box>
      )}
      {visible.map((item, i) =>
        item.kind === 'tool' ? (
          <ToolLine key={i} tc={item.tc} spinnerFrame={spinnerFrame} />
        ) : (
          <SubagentLine key={i} sub={item.sub} spinnerFrame={spinnerFrame} />
        ),
      )}
    </Box>
  );
}
