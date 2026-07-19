import React from 'react';
import { Box, Text } from 'ink';
import type { PermissionPromptState } from '../ui-types.js';
import { PERMISSION_OPTIONS } from '../ui-types.js';
import { formatToolArgs } from './ToolLine.js';
import { ACCENT } from '../theme.js';

export function PermissionOverlay({
  prompt,
}: {
  prompt: PermissionPromptState;
}) {
  const preview = formatToolArgs(prompt.tool, prompt.args);
  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1} paddingBottom={1} borderStyle="round" borderColor={ACCENT}>
      <Text color={ACCENT}>Permission required</Text>
      <Text>
        <Text dimColor>tool  </Text>
        {prompt.tool}
      </Text>
      <Text>
        <Text dimColor>args  </Text>
        {preview}
      </Text>
      {prompt.reason ? (
        <Text dimColor>{prompt.reason}</Text>
      ) : null}
      <Text> </Text>
      {PERMISSION_OPTIONS.map((opt, i) => (
        <Text key={opt.key} color={i === prompt.selected ? 'white' : undefined} dimColor={i !== prompt.selected}>
          {i === prompt.selected ? '› ' : '  '}
          {i + 1}. {opt.label}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>↑/↓ or 1-3  ·  enter confirm  ·  esc reject</Text>
    </Box>
  );
}
