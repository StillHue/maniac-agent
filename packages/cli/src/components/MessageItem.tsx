import React from 'react';
import { Box, Text } from 'ink';
import { ToolSection } from './ToolLine.js';
import { SubagentSection } from './SubagentBlock.js';
import { renderMarkdown } from '../markdown.js';
import { MUTED } from '../theme.js';
import type { StaticItem } from '../ui-types.js';
import { ThoughtStaticLine } from './ThoughtBlock.js';

export function MessageItem({ item }: { item: StaticItem }) {
  if (item.type === 'user') {
    return (
      <Box paddingLeft={2} paddingRight={2} marginBottom={1}>
        <Text dimColor>you     </Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }

  if (item.type === 'thought') {
    return <ThoughtStaticLine text={item.text} durationMs={item.durationMs} />;
  }

  if (item.type === 'assistant') {
    const hasChrome =
      item.tools.length > 0 || (item.subagents && item.subagents.length > 0);
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} marginBottom={1}>
        {item.thought ? (
          <Box marginBottom={item.text || hasChrome ? 1 : 0} flexDirection="column">
            <ThoughtStaticLine text={item.thought} durationMs={item.thoughtDurationMs} bare />
          </Box>
        ) : null}
        {item.tools.length > 0 ? (
          <ToolSection tools={item.tools} showOutput />
        ) : null}
        {item.subagents && item.subagents.length > 0 ? (
          <SubagentSection subagents={item.subagents} />
        ) : null}
        {item.text ? (
          <Box marginTop={hasChrome ? 0 : 0}>
            <Text color={MUTED}>maniac  </Text>
            <Text>{renderMarkdown(item.text)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  if (item.type === 'system') {
    const color =
      item.variant === 'error'
        ? 'red'
        : item.variant === 'success'
          ? 'green'
          : item.variant === 'warn'
            ? 'yellow'
            : undefined;
    return (
      <Box paddingLeft={2} marginBottom={1}>
        <Text color={color} dimColor={!color}>
          {item.text}
        </Text>
      </Box>
    );
  }

  return null;
}
