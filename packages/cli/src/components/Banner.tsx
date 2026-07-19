import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { loadManiacConfig, PROVIDER_DEFS } from '@maniac/engine';
import { ACCENT, ACCENT_BRIGHT } from '../theme.js';

type Style = 'dim' | 'chip' | 'bolt' | 'spark';

/**
 * Maniac thunderstorm: storm clouds, rain, a lightning strike,
 * and the chip mascot vibing right under it — antenna up, catching volts.
 * Each row is a list of [text, style] segments; row widths must match.
 */
const SCENE: [string, Style][][] = [
  [
    ['   ▒▓▓▓▓▓▓▒░        ░▒▓▓▓▓▓▓▓▓▓▓▓▒░          ░▒▓▓▓▓▓▒   ', 'dim'],
  ],
  [
    [' ▒▓▓▓▓▓▓▓▓▓▓▒░    ░▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒░     ░▒▓▓▓▓▓▓▓▓▒ ', 'dim'],
  ],
  [
    ['   ░▒▒▓▓▓▒▒░        ░░▒▒▓▓▓▓▓', 'dim'],
    ['▄█▀', 'bolt'],
    ['▓▓▒▒░░         ░▒▓▓▓▒▒░  ', 'dim'],
  ],
  [
    ['  ╱      ╱     ╱        ╱   ', 'dim'],
    ['▄█▀', 'bolt'],
    ['      ╱       ╱      ╱    ', 'dim'],
  ],
  [
    ['     ╱      ╱      ╱       ', 'dim'],
    ['▀██▄', 'bolt'],
    ['   ╱      ╱       ╱       ', 'dim'],
  ],
  [
    ['  ╱     ╱      ╱      ╱      ', 'dim'],
    ['▀█▄', 'bolt'],
    ['     ╱      ╱      ╱     ', 'dim'],
  ],
  [
    ['      ╱     ╱     ╱        ', 'dim'],
    ['✦ ', 'spark'],
    ['▄█', 'bolt'],
    ['  ', 'dim'],
    ['✦', 'spark'],
    ['     ╱       ╱          ', 'dim'],
  ],
  [
    ['             ╱           ▄█████████▄         ╱          ', 'chip'],
  ],
  [
    ['    ╱       ✧           ▐███ ███ ███▌   ✧        ╱      ', 'chip'],
  ],
  [
    ['        ╱               ▐███ ███ ███▌        ╱          ', 'chip'],
  ],
  [
    ['   ╱          ╱          ▀█████████▀             ╱      ', 'chip'],
  ],
];

// Rows where the "chip" style should only color the mascot slice, not the rain.
const CHIP_SLICE: Record<number, [number, number]> = {
  7: [25, 36],
  8: [24, 37],
  9: [24, 37],
  10: [25, 36],
};

const SCENE_WIDTH = SCENE.map((row) => row.reduce((n, [t]) => n + t.length, 0)).reduce(
  (a, b) => Math.max(a, b),
  0,
);

// Mascot pins threaded through the baseline dots.
const PINS = '█ █   █ █';
const PINS_START = 26;

const GREETINGS = [
  'what shall we break today?',
  'insane ideas welcome.',
  'give me something impossible.',
  'chaos, but organized.',
  'ready to go off-script.',
  'feed me a maniac idea.',
];

function styleColor(style: Style): { color?: string; dim?: boolean; bold?: boolean } {
  switch (style) {
    case 'chip':
      return { color: ACCENT };
    case 'bolt':
      return { color: ACCENT_BRIGHT, bold: true };
    case 'spark':
      return { color: ACCENT_BRIGHT };
    default:
      return { dim: true };
  }
}

function SceneRow({ row, index }: { row: [string, Style][]; index: number }) {
  const slice = CHIP_SLICE[index];
  if (slice && row.length === 1) {
    // Single-segment chip rows: color only the mascot slice, rain stays dim.
    const [text] = row[0];
    const [a, b] = slice;
    return (
      <Text>
        <Text dimColor>{text.slice(0, a)}</Text>
        <Text color={ACCENT}>{text.slice(a, b)}</Text>
        <Text dimColor>{text.slice(b)}</Text>
      </Text>
    );
  }
  return (
    <Text>
      {row.map(([text, style], i) => {
        const s = styleColor(style);
        return (
          <Text key={i} color={s.color} dimColor={s.dim} bold={s.bold}>
            {text}
          </Text>
        );
      })}
    </Text>
  );
}

function resolveSessionInfo(): { provider: string; model: string; endpoint: string; mode: string } {
  const cfg = loadManiacConfig();
  if (!cfg) return { provider: '—', model: '—', endpoint: '—', mode: 'setup' };
  if (cfg.provider === 'auto') {
    return { provider: 'Auto', model: cfg.model || 'auto', endpoint: 'router', mode: 'auto' };
  }
  const def = PROVIDER_DEFS.find((p) => p.id === cfg.provider);
  return {
    provider: def?.name || cfg.provider,
    model: cfg.model || 'auto',
    endpoint: cfg.baseUrl || def?.baseUrl || '—',
    mode: cfg.provider,
  };
}

function InfoRow({ label, value, width }: { label: string; value: string; width: number }) {
  const labelW = 12;
  const maxVal = Math.max(8, width - labelW - 4);
  const truncated = value.length > maxVal ? value.slice(0, maxVal - 1) + '…' : value;
  return (
    <Text>
      <Text dimColor>{label.padEnd(labelW)}</Text>
      <Text>{truncated}</Text>
    </Text>
  );
}

export function Banner() {
  const cols = process.stdout.columns || 80;
  const showScene = cols >= SCENE_WIDTH + 4;
  // Left-aligned layout: everything anchors at the chat's left padding,
  // and the tagline centers under the scene art (not the terminal).
  const basePad = 2;
  const scenePad = basePad;

  const panelWidth = Math.min(Math.max(SCENE_WIDTH, 56), cols - 4);
  const panelPad = basePad;
  const innerWidth = panelWidth - 2;

  // Picked once per mount — the banner re-renders every cursor blink, and
  // re-rolling the greeting each render made it flicker through phrases.
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  const [info] = useState(resolveSessionInfo);
  const tagline = "the 'what the hell, let's try it' agent";
  const tagWidth = showScene ? SCENE_WIDTH : panelWidth;
  const tagPad = basePad + Math.max(0, Math.floor((tagWidth - tagline.length - 4) / 2));

  const leftDots = '·'.repeat(PINS_START);
  const rightDots = '·'.repeat(Math.max(0, SCENE_WIDTH - PINS_START - PINS.length));

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text> </Text>

      <Box paddingLeft={panelPad}>
        <Text>
          <Text dimColor>  Welcome to </Text>
          <Text color={ACCENT} bold>
            maniac
          </Text>
          <Text dimColor> v0.1.0</Text>
        </Text>
      </Box>
      <Box paddingLeft={panelPad}>
        <Text color={ACCENT}>{'·'.repeat(panelWidth)}</Text>
      </Box>
      <Text> </Text>

      {showScene &&
        SCENE.map((row, i) => (
          <Box key={i} paddingLeft={scenePad}>
            <SceneRow row={row} index={i} />
          </Box>
        ))}

      {showScene && (
        <Box paddingLeft={scenePad}>
          <Text dimColor>
            {leftDots}
            <Text color={ACCENT}>{PINS}</Text>
            {rightDots}
          </Text>
        </Box>
      )}

      <Text> </Text>
      <Box paddingLeft={tagPad}>
        <Text>
          <Text color={ACCENT_BRIGHT}>✦ </Text>
          <Text>{tagline}</Text>
          <Text color={ACCENT_BRIGHT}> ✦</Text>
        </Text>
      </Box>
      <Text> </Text>

      <Box paddingLeft={panelPad}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={ACCENT}
          paddingX={1}
          width={panelWidth}
        >
          <InfoRow label="Provider" value={info.provider} width={innerWidth} />
          <InfoRow label="Model" value={info.model} width={innerWidth} />
          <InfoRow label="Endpoint" value={info.endpoint} width={innerWidth} />
          <Text dimColor>{'·'.repeat(Math.max(10, innerWidth - 2))}</Text>
          <Text>
            <Text color={ACCENT}>●</Text> <Text bold>{info.mode}</Text>
            <Text dimColor>
              {`  ·  ${greeting}`}
              {`● ${info.mode}  ·  ${greeting}  ·  type / to begin`.length <= innerWidth - 2
                ? '  ·  type / to begin'
                : ''}
            </Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
