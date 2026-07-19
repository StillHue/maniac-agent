import * as fs from 'fs';
import * as path from 'path';
import { createProposal, scoreEvidence, type ImprovementProposal } from './store';
import { isProposalOnly } from '../autonomy';

const STALE_DAYS = 30;
const SKILLS_DIR = path.join(__dirname, '..', 'skills');

/** Detect archive opportunities from skill mtimes (dry-run; never renames). */
export function detectCuratorArchiveProposals(): ImprovementProposal[] {
  if (!isProposalOnly()) return [];
  const out: ImprovementProposal[] = [];
  const now = Date.now();
  if (!fs.existsSync(SKILLS_DIR)) return out;

  try {
    const categories = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const cat of categories) {
      if (!cat.isDirectory() || cat.name.startsWith('.')) continue;
      const catPath = path.join(SKILLS_DIR, cat.name);
      for (const skill of fs.readdirSync(catPath, { withFileTypes: true })) {
        if (!skill.isDirectory()) continue;
        const skillMd = path.join(catPath, skill.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        const ageDays = (now - fs.statSync(skillMd).mtimeMs) / (86400 * 1000);
        if (ageDays < STALE_DAYS) continue;
        const score = scoreEvidence({
          frequency: Math.min(1, ageDays / 90),
          severity: 0.4,
          recency: 0.5,
          userSignal: 0,
        });
        const p = createProposal({
          kind: 'curator_archive',
          title: `Archive stale skill ${skill.name}`,
          rationale: `Skill untouched for ${Math.floor(ageDays)} days.`,
          score,
          signals: [`mtime_age_days=${Math.floor(ageDays)}`],
          targetPath: skillMd,
          action: 'archive',
          diff: `Archive ${path.join(cat.name, skill.name)}`,
          applyPlan: [{ tool: 'curator_run', args: '' }],
        });
        if (p) out.push(p);
      }
    }
  } catch {}
  return out;
}

export function recordSkillUsage(name: string, event: 'view' | 'create' | 'fail'): void {
  try {
    const dir = path.join(require('os').homedir(), '.maniac');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'skills-usage.jsonl'),
      JSON.stringify({ t: Date.now(), name, event }) + '\n',
    );
  } catch {}
}

export function detectAndEnqueueProposals(): ImprovementProposal[] {
  return detectCuratorArchiveProposals();
}
