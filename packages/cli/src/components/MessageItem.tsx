import React from 'react';
import { Box, Text } from 'ink';
import { Banner } from './Banner.js';
import { ToolLine } from './ToolLine.js';
import { renderMarkdown } from '../markdown.js';
import type { StaticItem } from '../ui-types.js';

export function MessageItem({ item }: { item: StaticItem }) {
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
        {item.tools.map((tc, i) => (
          <ToolLine key={i} tc={tc} showOutput />
        ))}
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
