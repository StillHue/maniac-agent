import React from 'react';
import { Box, Text } from 'ink';
import { MUTED, THINK } from '../theme.js';
import type { ThoughtEntry } from '../ui-types.js';

/** Compact one-liner for Static history (never expands in-place — Ink Static is immutable). */
export function ThoughtStaticLine({ text }: { text: string }) {
  const chars = text.trim().length;
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 64);
  return (
    <Box paddingLeft={2} paddingRight={2} marginBottom={1} flexDirection="column">
      <Box>
        <Text color={THINK}>▸ thought</Text>
        <Text dimColor>{`  ·  ${chars} chars`}</Text>
      </Box>
      {preview ? (
        <Box>
          <Text color={MUTED}>{'  └ '}</Text>
          <Text dimColor>
            {preview}
            {chars > 64 ? '…' : ''}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Live streaming thought — short tail only. */
export function LiveThought({
  text,
  spinnerFrame,
}: {
  text: string;
  spinnerFrame?: string;
}) {
  const trim = text.replace(/\s+/g, ' ').trim();
  if (!trim) return null;
  const preview = trim.length > 72 ? trim.slice(-72) : trim;

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <Box>
        <Text color={THINK}>
          <Text color={THINK}>{spinnerFrame || '·'} </Text>
          thought
        </Text>
        <Text dimColor>{'  streaming…'}</Text>
      </Box>
      <Box>
        <Text color={MUTED}>{'  └ '}</Text>
        <Text dimColor>{preview}</Text>
      </Box>
    </Box>
  );
}

/**
 * Only the latest thought is expandable (mutable region).
 * Older thoughts live in Static as ThoughtStaticLine — avoids Ink/Windows redraw ghosts.
 */
export function ExpandableThought({
  entry,
  expanded,
}: {
  entry: ThoughtEntry;
  expanded: boolean;
}) {
  const lines = entry.text.split(/\r?\n/).filter((l) => l.trim());
  const chars = entry.text.trim().length;

  if (!expanded) return null;

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <Box>
        <Text color={THINK}>▾ thought</Text>
        <Text dimColor>{`  ·  ${chars} chars  ·  ctrl+e collapse`}</Text>
      </Box>
      {entry.text
        .trim()
        .split(/\r?\n/)
        .slice(0, 40)
        .map((line, i) => (
          <Box key={i}>
            <Text color={MUTED}>{'  │ '}</Text>
            <Text dimColor>{line || ' '}</Text>
          </Box>
        ))}
      {lines.length > 40 ? (
        <Box>
          <Text color={MUTED}>{'  └ … '}</Text>
          <Text dimColor>{`${lines.length - 40} more lines`}</Text>
        </Box>
      ) : (
        <Box>
          <Text color={MUTED}>{'  └─'}</Text>
        </Box>
      )}
    </Box>
  );
}
