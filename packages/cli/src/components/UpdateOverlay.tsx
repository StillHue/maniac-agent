import React from 'react';
import { Box, Text } from 'ink';
import { ACCENT, ACCENT_BRIGHT, OK, FAIL } from '../theme.js';
import type { Installer } from '../update-check.js';
import { updateCommand } from '../update-check.js';

export type UpdatePhase = 'ask' | 'installing' | 'done' | 'error';

export function UpdateOverlay({
  current,
  latest,
  installer,
  phase,
  error,
}: {
  current: string;
  latest: string;
  installer: Installer;
  phase: UpdatePhase;
  error?: string;
}) {
  const cmd = updateCommand(installer, latest);

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="round"
      borderColor={ACCENT}
      width={Math.min(72, (process.stdout.columns || 80) - 2)}
    >
      <Text color={ACCENT} bold>
        Update available
      </Text>
      <Text>
        <Text dimColor>installed  </Text>
        <Text>{current}</Text>
        <Text dimColor>  →  </Text>
        <Text color={ACCENT_BRIGHT} bold>
          {latest}
        </Text>
      </Text>
      <Text> </Text>

      {phase === 'ask' && (
        <>
          <Text dimColor>Run update now?</Text>
          <Text>
            <Text dimColor>$ </Text>
            {cmd}
          </Text>
          <Text> </Text>
          <Text>
            <Text color={OK} bold>
              Y
            </Text>
            <Text dimColor> update  ·  </Text>
            <Text bold>N</Text>
            <Text dimColor> skip this version  ·  </Text>
            <Text bold>B</Text>
            <Text dimColor> toggle npm/bun</Text>
          </Text>
          <Text dimColor>Y confirm · N skip · B switch installer · Esc dismiss once</Text>
        </>
      )}

      {phase === 'installing' && (
        <Text color={ACCENT}>
          Installing with {installer}…
        </Text>
      )}

      {phase === 'done' && (
        <>
          <Text color={OK} bold>
            Updated to {latest}
          </Text>
          <Text dimColor>Restart maniac to load the new binary (exiting…).</Text>
        </>
      )}

      {phase === 'error' && (
        <>
          <Text color={FAIL} bold>
            Update failed
          </Text>
          {error ? <Text dimColor>{error.slice(0, 400)}</Text> : null}
          <Text dimColor>Press any key to continue · or run manually:</Text>
          <Text>
            <Text dimColor>$ </Text>
            {cmd}
          </Text>
        </>
      )}
    </Box>
  );
}
