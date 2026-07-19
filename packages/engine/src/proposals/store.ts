import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { loadAutonomyConfig } from '../autonomy';

export type ProposalKind =
  | 'skill_improve'
  | 'skill_create'
  | 'source_patch'
  | 'prompt_tune'
  | 'memory_consolidate'
  | 'curator_archive';

export type ProposalStatus =
  | 'draft'
  | 'pending'
  | 'validated'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed';

export interface ImprovementProposal {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: ProposalStatus;
  kind: ProposalKind;
  title: string;
  rationale: string;
  evidence: { score: number; signals: string[]; fingerprint: string };
  targets: { path: string; action: 'create' | 'patch' | 'archive' | 'rewrite' }[];
  diff: string;
  applyPlan: { tool: string; args: string }[];
}

const DIR =
  process.env.MANIAC_PROPOSALS_DIR ||
  path.join(process.env.MANIAC_DIR || path.join(os.homedir(), '.maniac'), 'proposals');

function ensureDir(): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

export function proposalFingerprint(kind: ProposalKind, title: string, targetPath: string): string {
  return createHash('sha1')
    .update(`${kind}|${targetPath}|${title.toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 16);
}

export function scoreEvidence(opts: {
  frequency: number;
  severity: number;
  recency: number;
  userSignal: number;
}): number {
  const score =
    0.4 * opts.frequency + 0.3 * opts.severity + 0.2 * opts.recency + 0.1 * opts.userSignal;
  return Math.max(0, Math.min(1, score));
}

export function listProposals(status?: ProposalStatus): ImprovementProposal[] {
  ensureDir();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  const items: ImprovementProposal[] = [];
  for (const f of files) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as ImprovementProposal;
      if (!status || p.status === status) items.push(p);
    } catch {}
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

function safeProposalId(id: string): string | null {
  if (!id || typeof id !== 'string') return null;
  // Only allow ids we mint: prop_<base36>_<hex>
  if (!/^prop_[a-z0-9]+_[a-z0-9]+$/i.test(id)) return null;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return null;
  return id;
}

export function getProposal(id: string): ImprovementProposal | null {
  const safe = safeProposalId(id);
  if (!safe) return null;
  const file = path.join(DIR, `${safe}.json`);
  const rel = path.relative(DIR, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function saveProposal(p: ImprovementProposal): void {
  ensureDir();
  const safe = safeProposalId(p.id);
  if (!safe) return;
  const cfg = loadAutonomyConfig();
  const pending = listProposals('pending');
  if (p.status === 'pending' && pending.length >= cfg.maxPending) {
    // Drop lowest score pending to make room
    const lowest = [...pending].sort((a, b) => a.evidence.score - b.evidence.score)[0];
    if (lowest && lowest.evidence.score <= p.evidence.score) {
      updateProposalStatus(lowest.id, 'rejected');
    } else {
      return;
    }
  }
  p.updatedAt = Date.now();
  fs.writeFileSync(path.join(DIR, `${safe}.json`), JSON.stringify(p, null, 2));
}

export function updateProposalStatus(
  id: string,
  status: ProposalStatus,
): ImprovementProposal | null {
  const p = getProposal(id);
  if (!p) return null;
  p.status = status;
  p.updatedAt = Date.now();
  saveProposal(p);
  return p;
}

export function createProposal(input: {
  kind: ProposalKind;
  title: string;
  rationale: string;
  score: number;
  signals: string[];
  targetPath: string;
  action: ImprovementProposal['targets'][0]['action'];
  diff: string;
  applyPlan: ImprovementProposal['applyPlan'];
}): ImprovementProposal | null {
  const fingerprint = proposalFingerprint(input.kind, input.title, input.targetPath);
  const existing = listProposals().find(
    (p) =>
      p.evidence.fingerprint === fingerprint &&
      (p.status === 'pending' || p.status === 'draft' || p.status === 'validated'),
  );
  if (existing) return existing;

  const thresholds: Record<ProposalKind, number> = {
    skill_improve: 0.65,
    skill_create: 0.75,
    source_patch: 0.8,
    prompt_tune: 0.7,
    memory_consolidate: 0.6,
    curator_archive: 0.5,
  };
  if (input.score < thresholds[input.kind]) return null;

  const id = `prop_${Date.now().toString(36)}_${fingerprint.slice(0, 6)}`;
  const proposal: ImprovementProposal = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    kind: input.kind,
    title: input.title,
    rationale: input.rationale,
    evidence: { score: input.score, signals: input.signals, fingerprint },
    targets: [{ path: input.targetPath, action: input.action }],
    diff: input.diff,
    applyPlan: input.applyPlan,
  };
  saveProposal(proposal);
  return proposal;
}
