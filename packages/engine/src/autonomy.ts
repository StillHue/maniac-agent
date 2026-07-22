import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type AutonomyMode = 'proposalOnly' | 'legacyApply';

export interface AutonomyConfig {
  mode: AutonomyMode;
  proposalIntervalMs: number;
  maxPending: number;
}

const CONFIG_PATH = path.join(
  process.env.MANIAC_DIR || path.join(os.homedir(), '.maniac'),
  'autonomy.json',
);

const DEFAULTS: AutonomyConfig = {
  mode: 'proposalOnly',
  proposalIntervalMs: 15 * 60 * 1000,
  maxPending: 20,
};

export function loadAutonomyConfig(): AutonomyConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch (e) {
    console.warn('[autonomy] loadAutonomyConfig falhou:', e);
  }
  return { ...DEFAULTS };
}

export function saveAutonomyConfig(cfg: Partial<AutonomyConfig>): AutonomyConfig {
  const next = { ...loadAutonomyConfig(), ...cfg };
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function isProposalOnly(): boolean {
  return loadAutonomyConfig().mode === 'proposalOnly';
}
