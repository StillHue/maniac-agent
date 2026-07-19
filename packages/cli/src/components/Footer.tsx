import React from 'react';
import { Box, Text } from 'ink';
import type { GitInfo } from '../cli-config.js';
import type { PermissionMode } from '@maniac/engine';

export function Footer({
  git,
  tokens,
  maxTokens,
  mode,
  permissionMode,
  cols,
  value,
  cursorVisible,
  isLoading,
  spinnerFrame,
  thinkingPhrase,
  reasoningText,
  activeModel,
  queueSize,
  sessionId,
}: {
  git: GitInfo;
  tokens: number;
  maxTokens: number;
  mode: string;
  permissionMode: PermissionMode;
  cols: number;
  value: string;
  cursorVisible: boolean;
  isLoading: boolean;
  spinnerFrame: string;
  thinkingPhrase: string;
  reasoningText: string;
  activeModel: string;
  queueSize: number;
  sessionId?: string;
}) {
  const pct = Math.round(Math.min(1, tokens / maxTokens) * 100);
  const leftParts = [
    git.branch ? `${git.repo}(${git.branch})` : git.repo,
    `${pct}% ctx`,
    mode,
    permissionMode === 'default' ? null : permissionMode,
    queueSize > 0 ? `q:${queueSize}` : null,
  ].filter(Boolean);
  const leftStatus = leftParts.join('  ·  ');
  const rightStatus = `● ${activeModel}`;
  const gap = Math.max(1, cols - 2 - leftStatus.length - rightStatus.length);

  const maxReasoningWidth = Math.max(20, cols - 8);
  const liveText = reasoningText
    ? reasoningText.replace(/\s+/g, ' ').trim().slice(-maxReasoningWidth)
    : '';
  const displayText = isLoading ? liveText || `${spinnerFrame} ${thinkingPhrase}` : '';

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text dimColor>{'─'.repeat(cols)}</Text>

      <Box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <Text dimColor>{isLoading ? '  ' : '> '}</Text>
        {isLoading ? (
          <Text dimColor>{displayText}</Text>
        ) : (
          <Text>
            {value}
            {cursorVisible ? <Text color="white">█</Text> : <Text> </Text>}
          </Text>
        )}
      </Box>

      <Box paddingLeft={2} paddingRight={2}>
        <Text dimColor>
          {leftStatus}
          {' '.repeat(gap)}
          {rightStatus}
        </Text>
      </Box>
      {sessionId ? (
        <Box paddingLeft={2}>
          <Text dimColor>session {sessionId.slice(0, 12)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
