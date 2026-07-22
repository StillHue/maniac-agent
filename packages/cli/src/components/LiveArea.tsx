import React from 'react';
import { Box, Text } from 'ink';
import { ToolSection } from './ToolLine.js';
import { SubagentSection } from './SubagentBlock.js';
import { LiveThought } from './ThoughtBlock.js';
import type { SubagentStatus, ToolCallView } from '../ui-types.js';

/**
 * Live activity region while a turn is running.
 * Sections (top → bottom): thought stream → tools → agents.
 */
export function LiveArea({
  tools,
  subagents,
  dispatchCount,
  maxLines: _maxLines,
  spinnerFrame,
  thinking,
}: {
  tools: ToolCallView[];
  subagents: SubagentStatus[];
  dispatchCount: number;
  maxLines: number;
  spinnerFrame?: string;
  thinking?: string;
}) {
  const hasTools = tools.length > 0;
  const hasAgents = subagents.length > 0 || dispatchCount > 0;
  const hasThought = !!(thinking && thinking.trim());

  if (!hasTools && !hasAgents && !hasThought) return null;

  // Cap visible tools/agents so the prompt stays on screen
  const toolBudget = 8;
  const agentBudget = 6;
  const visibleTools = tools.length > toolBudget ? tools.slice(-toolBudget) : tools;
  const visibleAgents =
    subagents.length > agentBudget ? subagents.slice(-agentBudget) : subagents;
  const hiddenTools = tools.length - visibleTools.length;
  const hiddenAgents = subagents.length - visibleAgents.length;

  return (
    <Box flexDirection="column" paddingLeft={0} paddingRight={2} flexShrink={0} marginBottom={1}>
      {hasThought ? <LiveThought text={thinking!} spinnerFrame={spinnerFrame} /> : null}

      {hasTools ? (
        <Box flexDirection="column" paddingLeft={2}>
          {hiddenTools > 0 ? (
            <Box>
              <Text dimColor>{`  ·  ${hiddenTools} earlier tools`}</Text>
            </Box>
          ) : null}
          <ToolSection tools={visibleTools} spinnerFrame={spinnerFrame} live />
        </Box>
      ) : null}

      {hasAgents ? (
        <Box flexDirection="column" paddingLeft={2}>
          {hiddenAgents > 0 ? (
            <Box>
              <Text dimColor>{`  ·  ${hiddenAgents} earlier agents`}</Text>
            </Box>
          ) : null}
          <SubagentSection
            subagents={visibleAgents}
            dispatchCount={dispatchCount}
            spinnerFrame={spinnerFrame}
            live
          />
        </Box>
      ) : null}
    </Box>
  );
}
