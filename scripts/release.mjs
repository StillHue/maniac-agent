#!/usr/bin/env node
/**
 * Bump publishable package versions, commit, and tag vX.Y.Z.
 * Pushing the tag triggers .github/workflows/publish.yml → npm (bun-compatible).
 *
 * Usage:
 *   node scripts/release.mjs 0.2.0
 *   node scripts/release.mjs patch|minor|major
 *   node scripts/release.mjs 0.2.0 --dry-run
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry-run');
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));

if (!arg) {
  console.error('Usage: node scripts/release.mjs <version|patch|minor|major> [--dry-run]');
  process.exit(1);
}

const PKG_PATHS = [
  'package.json',
  'packages/types/package.json',
  'packages/engine/package.json',
  'packages/cli/package.json',
  'packages/prompts/package.json',
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function bump(ver, kind) {
  const [maj, min, pat] = ver.split('.').map((n) => parseInt(n, 10));
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (!/^\d+\.\d+\.\d+$/.test(kind)) {
    throw new Error(`Invalid version: ${kind}`);
  }
  return kind;
}

const current = readJson(path.join(root, 'packages/cli/package.json')).version;
const next = bump(current, arg);
const tag = `v${next}`;

console.log(`${current} → ${next} (tag ${tag})${dry ? ' [dry-run]' : ''}`);

for (const rel of PKG_PATHS) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  const j = readJson(p);
  j.version = next;
  if (!dry) writeJson(p, j);
  console.log(`  version ${rel}`);
}

// Keep workspace CLI deps as * (yarn); published tarball is bundled separately.
function git(args) {
  const r = spawnSync('git', args, { cwd: root, stdio: 'inherit', shell: true });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

if (dry) {
  console.log('Dry run — no commit/tag.');
  process.exit(0);
}

git(['add', ...PKG_PATHS]);
git(['commit', '-m', `chore: release ${tag}`]);
git(['tag', '-a', tag, '-m', `Release ${tag}`]);

console.log(`
Next:
  git push origin HEAD --tags

CI will publish maniac-agent@${next} to npm (installable via npm and bun).
Requires GitHub secret NPM_TOKEN.
`);
