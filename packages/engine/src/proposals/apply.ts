import { getProposal, updateProposalStatus } from './store';
import { isProposalOnly } from '../autonomy';

const ALLOWED_APPLY_TOOLS = new Set([
  'skill_create',
  'memory_save',
  'curator_run',
]);

/**
 * Apply an explicitly approved proposal.
 * Background/autonomy never calls this — only CLI /approve, tools, or Telegram.
 * applyPlan tools are restricted to a small allowlist; curator_archive uses a
 * dedicated path-jailed archive helper.
 */
export async function applyProposal(
  id: string,
  cwd: string = process.cwd(),
): Promise<{ success: boolean; output: string }> {
  const p = getProposal(id);
  if (!p) return { success: false, output: `Proposal not found: ${id}` };
  if (p.status === 'applied') return { success: false, output: `Already applied: ${id}` };
  if (p.status === 'rejected' || p.status === 'failed') {
    return { success: false, output: `Cannot apply proposal in status ${p.status}` };
  }

  updateProposalStatus(id, 'approved');
  const lines: string[] = [`Applying ${id} (${p.kind}): ${p.title}`];

  try {
    if (p.kind === 'curator_archive' && p.targets[0]?.path) {
      const { archiveSkillByPath } = require('../curator') as typeof import('../curator');
      const r = archiveSkillByPath(p.targets[0].path);
      lines.push(r.output);
      if (!r.success) {
        updateProposalStatus(id, 'failed');
        return { success: false, output: lines.join('\n') };
      }
    } else {
      const { executeToolCall } = require('../tools') as typeof import('../tools');
      for (const step of p.applyPlan) {
        if (!ALLOWED_APPLY_TOOLS.has(step.tool)) {
          updateProposalStatus(id, 'failed');
          return {
            success: false,
            output: `Blocked apply tool "${step.tool}" — not in allowlist (${[...ALLOWED_APPLY_TOOLS].join(', ')})`,
          };
        }
        const result = await executeToolCall(step.tool, step.args, cwd);
        lines.push(`[${step.tool}] ${result.success ? 'ok' : 'fail'}: ${result.output.slice(0, 500)}`);
        if (!result.success) {
          updateProposalStatus(id, 'failed');
          return { success: false, output: lines.join('\n') };
        }
      }
    }

    updateProposalStatus(id, 'applied');
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const audit = path.join(os.homedir(), '.maniac', 'audit.log');
      fs.mkdirSync(path.dirname(audit), { recursive: true });
      fs.appendFileSync(
        audit,
        `${new Date().toISOString()}  proposal_apply  ${id}  proposalOnly=${isProposalOnly()}  →  ok\n`,
      );
    } catch {}

    lines.push(`Applied ${id}`);
    return { success: true, output: lines.join('\n') };
  } catch (e: any) {
    updateProposalStatus(id, 'failed');
    return { success: false, output: `Apply failed: ${e.message}\n${lines.join('\n')}` };
  }
}
