const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_DIM = '\x1b[38;5;245m';
const ANSI_RED = '\x1b[38;5;203m';

export function renderMarkdown(text: string): string {
  return text
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_m, lang: string, code: string) =>
        `\n${ANSI_DIM}${ANSI_BOLD}▌${ANSI_RESET}${ANSI_DIM} ${lang || 'code'}${ANSI_RESET}\n${ANSI_DIM}${code.trimEnd()}${ANSI_RESET}\n`,
    )
    .replace(/`([^`]+)`/g, `${ANSI_DIM}$1${ANSI_RESET}`)
    .replace(/\*\*(.+?)\*\*/g, `${ANSI_BOLD}$1${ANSI_RESET}`)
    .replace(/\*(.+?)\*/g, `${ANSI_DIM}$1${ANSI_RESET}`)
    .replace(/^#{1,3} (.+)$/gm, `${ANSI_BOLD}${ANSI_RED}$1${ANSI_RESET}`)
    .replace(/^[-*] (.+)$/gm, `  ${ANSI_DIM}•${ANSI_RESET} $1`)
    .replace(/^\d+\. (.+)$/gm, `  ${ANSI_DIM}›${ANSI_RESET} $1`);
}
