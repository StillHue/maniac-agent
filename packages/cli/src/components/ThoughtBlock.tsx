import React from 'react';
import { Box, Text } from 'ink';
import { MUTED, THINK } from '../theme.js';
import type { ThoughtEntry } from '../ui-types.js';

const COLLAPSED_LINES = 6;
const WRAP_COLS = 68;

/** Soft-wrap a long line into display rows (thought often arrives as one blob). */
export function wrapThoughtLines(text: string, width = WRAP_COLS): string[] {
  const raw = text.replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const para of raw.split(/\n+/)) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      if (!line) {
        line = w;
      } else if (line.length + 1 + w.length <= width) {
        line += ` ${w}`;
      } else {
        out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function formatThoughtDuration(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function ThoughtHeader({
  chars,
  expanded,
  durationMs,
  streaming,
  spinnerFrame,
}: {
  chars: number;
  expanded?: boolean;
  durationMs?: number;
  streaming?: boolean;
  spinnerFrame?: string;
}) {
  const dur = formatThoughtDuration(durationMs);
  const bits = [
    streaming ? 'streaming…' : `${chars} chars`,
    dur ? dur : null,
    !streaming ? (expanded ? 'ctrl+e collapse' : 'ctrl+e expand') : null,
  ].filter(Boolean);

  return (
    <Box>
      <Text color={THINK}>
        {streaming ? `${spinnerFrame || '·'} ` : expanded ? '▾ ' : '▸ '}
        thought
      </Text>
      <Text dimColor>{`  ·  ${bits.join('  ·  ')}`}</Text>
    </Box>
  );
}

function ThoughtBody({
  lines,
  maxLines,
}: {
  lines: string[];
  maxLines?: number;
}) {
  const shown = maxLines != null ? lines.slice(0, maxLines) : lines;
  const hidden = maxLines != null ? Math.max(0, lines.length - shown.length) : 0;
  return (
    <Box flexDirection="column">
      {shown.map((line, i) => (
        <Box key={i}>
          <Text color={MUTED}>{i === shown.length - 1 && hidden === 0 ? '  └ ' : '  │ '}</Text>
          <Text dimColor>{line || ' '}</Text>
        </Box>
      ))}
      {hidden > 0 ? (
        <Box>
          <Text color={MUTED}>{'  └ … '}</Text>
          <Text dimColor>{`${hidden} more lines`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Compact history line (Ink Static — immutable). */
export function ThoughtStaticLine({
  text,
  durationMs,
  bare,
}: {
  text: string;
  durationMs?: number;
  /** Skip outer padding when nested inside MessageItem. */
  bare?: boolean;
}) {
  const lines = wrapThoughtLines(text);
  const chars = text.trim().length;
  return (
    <Box
      paddingLeft={bare ? 0 : 2}
      paddingRight={bare ? 0 : 2}
      marginBottom={bare ? 0 : 1}
      flexDirection="column"
    >
      <ThoughtHeader chars={chars} durationMs={durationMs} />
      <ThoughtBody lines={lines} maxLines={COLLAPSED_LINES} />
    </Box>
  );
}

/** Live streaming thought — multi-line tail. */
export function LiveThought({
  text,
  spinnerFrame,
  durationMs,
}: {
  text: string;
  spinnerFrame?: string;
  durationMs?: number;
}) {
  const lines = wrapThoughtLines(text);
  if (lines.length === 0) return null;
  const tail = lines.slice(-COLLAPSED_LINES);
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <ThoughtHeader
        chars={text.trim().length}
        streaming
        spinnerFrame={spinnerFrame}
        durationMs={durationMs}
      />
      <ThoughtBody lines={tail} />
    </Box>
  );
}

/**
 * Latest thought — expandable in the mutable region (Static cannot expand in-place).
 */
export function ExpandableThought({
  entry,
  expanded,
}: {
  entry: ThoughtEntry;
  expanded: boolean;
}) {
  const lines = wrapThoughtLines(entry.text);
  const chars = entry.text.trim().length;
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
      <ThoughtHeader chars={chars} expanded={expanded} durationMs={entry.durationMs} />
      <ThoughtBody lines={lines} maxLines={expanded ? undefined : COLLAPSED_LINES} />
    </Box>
  );
}
