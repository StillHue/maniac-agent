#!/usr/bin/env node
/**
 * First publish must be interactive: npm blocked Automation tokens that bypass 2FA.
 * This packs the tarball and opens web login, then publishes.
 *
 *   yarn build:all && yarn build:cli
 *   node scripts/first-publish.mjs
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, ...opts });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

console.log('Packing maniac-agent…');
run('node', ['scripts/pack-npm.mjs']);

console.log('\nLogging into npm (browser / 2FA)…');
run('npm', ['login', '--auth-type=web']);

console.log('\nPublishing…');
run('npm', ['publish', '--access', 'public'], { cwd: path.join(root, 'dist-npm') });

console.log(`
✓ Published.

Next (one-time, for CI auto-publish):
1. https://www.npmjs.com/package/maniac-agent → Settings → Trusted Publisher
2. GitHub Actions: StillHue / maniac-agent / publish.yml
3. Future tags v* publish via OIDC (no token needed)
`);
