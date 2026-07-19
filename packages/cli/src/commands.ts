export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'mode', args: 'chat|ask|plan', description: 'switch conversation mode' },
  {
    name: 'permissions',
    args: '<mode>',
    description: 'default | acceptEdits | plan | dontAsk | bypassPermissions',
  },
  { name: 'model', description: 'configure provider and model' },
  { name: 'clear', description: 'clear conversation / new session' },
  { name: 'new', description: 'alias for /clear' },
  { name: 'compact', description: 'compress the context window' },
  { name: 'resume', args: '[id]', description: 'list or resume a saved session' },
  { name: 'continue', description: 'resume most recent session for this cwd' },
  { name: 'history', description: 'show session messages' },
  { name: 'paste', description: 'attach clipboard image as [imageN]' },
  { name: 'proposals', description: 'list pending improvement proposals' },
  { name: 'approve', args: '<id>', description: 'apply an improvement proposal' },
  { name: 'reject', args: '<id>', description: 'reject an improvement proposal' },
  { name: 'help', description: 'show this help' },
  { name: 'exit', description: 'quit maniac' },
];

export const HELP_TEXT = [
  'Commands:',
  '',
  ...SLASH_COMMANDS.map((c) => {
    const left = `  /${c.name}${c.args ? ' ' + c.args : ''}`.padEnd(26);
    return `${left}${c.description}`;
  }),
  '',
  '  Shift+Tab               cycle engine mode (chat → ask → plan)',
  '  Ctrl+T                  cycle permission mode',
  '  Alt+V                   attach clipboard image (or /paste)',
  '  ↑/↓                     command history',
].join('\n');

/**
 * Returns the commands that match the current input, or null when the
 * slash menu should not be shown (empty input, not a slash, or already
 * past the command token).
 */
export function matchSlashCommands(input: string): SlashCommand[] | null {
  if (!input.startsWith('/')) return null;
  // Menu only while typing the command itself (no space yet).
  if (input.includes(' ')) return null;
  const query = input.slice(1).toLowerCase();
  const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
  return matches.length > 0 ? matches : null;
}
