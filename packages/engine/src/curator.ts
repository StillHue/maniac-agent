import * as fs from 'fs';
import * as path from 'path';

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const CURATOR_STATE_FILE = path.join(SKILLS_DIR, '.curator_state.json');
const ARCHIVE_DIR = path.join(SKILLS_DIR, '.archive');

const STALE_DAYS = 30;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface CuratorState {
  lastRun: number;
  intervalHours: number;
  snapshotPath?: string | null;
}

function loadState(): CuratorState {
  try {
    if (fs.existsSync(CURATOR_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(CURATOR_STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.debug('[curator] loadState falhou:', e);
  }
  return { lastRun: 0, intervalHours: 24 };
}

function saveState(state: CuratorState): void {
  try {
    const dir = path.dirname(CURATOR_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CURATOR_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.debug('[curator] saveState falhou:', e);
    }
  }

function takeSnapshot(): string | null {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotDir = path.join(ARCHIVE_DIR, `.snapshot-${stamp}`);
    if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

    const categories = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const cat of categories) {
      if (!cat.isDirectory() || cat.name.startsWith('.')) continue;
      const catPath = path.join(SKILLS_DIR, cat.name);
      const skills = fs.readdirSync(catPath, { withFileTypes: true });
      for (const skill of skills) {
        if (!skill.isDirectory()) continue;
        const src = path.join(catPath, skill.name, 'SKILL.md');
        if (!fs.existsSync(src)) continue;
        const dstDir = path.join(snapshotDir, cat.name, skill.name);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(src, path.join(dstDir, 'SKILL.md'));
      }
    }

    return snapshotDir;
  } catch (e) {
    console.warn('[curator] takeSnapshot falhou:', e);
    return null;
  }
}

export function getCuratorStatus(): { success: boolean; output: string } {
  const state = loadState();
  const lastRunStr = state.lastRun
    ? new Date(state.lastRun).toISOString()
    : 'nunca';
  const nextRun = state.lastRun
    ? new Date(state.lastRun + state.intervalHours * 3600000).toISOString()
    : 'agora';
  return {
    success: true,
    output: `Curador:\n  Última execução: ${lastRunStr}\n  Intervalo: ${state.intervalHours}h\n  Próxima: ${nextRun}\n  Snapshot: ${state.snapshotPath || 'nenhum'}`,
  };
}

export function runCurator(opts: { dryRun?: boolean } = {}): { success: boolean; output: string } {
  try {
    const { isProposalOnly } = require('./autonomy');
    const { detectCuratorArchiveProposals } = require('./proposals');
    const proposalOnly = opts.dryRun ?? isProposalOnly();

    if (proposalOnly) {
      const proposals = detectCuratorArchiveProposals();
      const state = loadState();
      state.lastRun = Date.now();
      saveState(state);
      return {
        success: true,
        output:
          `Curador em modo proposal-only (dry-run).\n` +
          `  Proposals criadas/atualizadas: ${proposals.length}\n` +
          (proposals.length
            ? proposals.map((p: any) => `  - ${p.id}: ${p.title}`).join('\n')
            : '  Nenhuma skill stale.'),
      };
    }

    const state = loadState();
    const now = Date.now();

    if (!fs.existsSync(SKILLS_DIR)) {
      return { success: true, output: 'Diretório de skills não existe.' };
    }

    const snapshotPath = takeSnapshot();
    state.snapshotPath = snapshotPath;

    const categories = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    let archived = 0;
    let active = 0;

    for (const cat of categories) {
      if (!cat.isDirectory() || cat.name.startsWith('.')) continue;
      const catPath = path.join(SKILLS_DIR, cat.name);
      const skills = fs.readdirSync(catPath, { withFileTypes: true });

      for (const skill of skills) {
        if (!skill.isDirectory()) continue;
        active++;

        const skillDir = path.join(catPath, skill.name);
        const skillMd = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;

        const stat = fs.statSync(skillMd);
        const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);

        if (ageDays > STALE_DAYS) {
          const archivePath = path.join(ARCHIVE_DIR, cat.name, skill.name);
          if (!fs.existsSync(archivePath)) fs.mkdirSync(archivePath, { recursive: true });
          fs.renameSync(skillDir, archivePath);
          archived++;
        }
      }
    }

    state.lastRun = now;
    saveState(state);

    return {
      success: true,
      output: `Curador executado.\n  Skills ativas: ${active}\n  Arquivadas: ${archived}\n  Snapshot: ${snapshotPath || 'falhou'}`,
    };
  } catch (e: any) {
    return { success: false, output: `Erro no curador: ${e.message}` };
  }
}

let curatorTimer: ReturnType<typeof setInterval> | null = null;

export function startCurator(): void {
  if (curatorTimer) return;
  const state = loadState();
  const interval = Math.max(state.intervalHours * 3600000, CHECK_INTERVAL_MS);
  curatorTimer = setInterval(() => runCurator(), interval);
}

export function stopCurator(): void {
  if (curatorTimer) {
    clearInterval(curatorTimer);
    curatorTimer = null;
  }
}

/** Archive a single skill by SKILL.md path (used by approved curator_archive proposals). */
export function archiveSkillByPath(skillMdPath: string): { success: boolean; output: string } {
  try {
    const skillDir = path.dirname(path.resolve(skillMdPath));
    const catName = path.basename(path.dirname(skillDir));
    const skillName = path.basename(skillDir);
    if (!fs.existsSync(skillMdPath)) {
      return { success: false, output: `Skill not found: ${skillMdPath}` };
    }
    // Jail: must live under SKILLS_DIR
    const rel = path.relative(SKILLS_DIR, skillDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, output: 'Archive denied: path outside skills directory' };
    }
    const archivePath = path.join(ARCHIVE_DIR, catName, skillName);
    if (!fs.existsSync(path.dirname(archivePath))) {
      fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    }
    if (fs.existsSync(archivePath)) {
      return { success: false, output: `Already archived: ${catName}/${skillName}` };
    }
    takeSnapshot();
    fs.renameSync(skillDir, archivePath);
    return { success: true, output: `Archived ${catName}/${skillName} → ${archivePath}` };
  } catch (e: any) {
    return { success: false, output: `Archive failed: ${e.message}` };
  }
}
