import React from 'react';
import { Box, Text } from 'ink';
import type { SlashCommand } from '../commands.js';
import { ACCENT } from '../theme.js';

export function SlashMenu({
  commands,
  selected,
}: {
  commands: SlashCommand[];
  selected: number;
}) {
  const labelOf = (c: SlashCommand) => `/${c.name}${c.args ? ' ' + c.args : ''}`;
  const labelWidth = Math.max(...commands.map((c) => labelOf(c).length));

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {commands.map((c, i) => {
        const active = i === selected;
        return (
          <Box key={c.name}>
            <Text color={active ? ACCENT : undefined} dimColor={!active}>
              {active ? '❯ ' : '  '}
              {labelOf(c).padEnd(labelWidth + 2)}
            </Text>
            <Text dimColor>{c.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
