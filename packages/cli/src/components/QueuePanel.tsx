import React from 'react';
import { Box, Text } from 'ink';
import type { QueueEntry } from '@maniac/engine';
import { ACCENT } from '../theme.js';

const MAX_VISIBLE = 3;
const PREVIEW_LEN = 72;

function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= PREVIEW_LEN) return oneLine;
  return oneLine.slice(0, PREVIEW_LEN - 1) + '…';
}

export function QueuePanel({ entries }: { entries: QueueEntry[] }) {
  if (entries.length === 0) return null;

  const visible = entries.slice(0, MAX_VISIBLE);
  const hidden = entries.length - visible.length;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Text>
        <Text color={ACCENT}>Queued</Text>
        <Text dimColor>{` (${entries.length})`}</Text>
      </Text>
      {visible.map((entry, i) => (
        <Box key={entry.id}>
          <Text dimColor>
            {`  ${i + 1}. `}
            {preview(entry.text)}
          </Text>
        </Box>
      ))}
      {hidden > 0 && (
        <Text dimColor>{`  … ${hidden} more`}</Text>
      )}
    </Box>
  );
}
