#!/usr/bin/env node
/**
 * Bundle the CLI + engine + types into a single npm-publishable package
 * named `maniac-agent` (bin: maniac). Works with npm and bun.
 *
 * Usage (from repo root, after yarn build:all && yarn build:cli):
 *   node scripts/pack-npm.mjs
 *   node scripts/pack-npm.mjs --publish   # npm publish dist-npm
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-npm');
const wantPublish = process.argv.includes('--publish');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const cliPkg = readJson(path.join(root, 'packages/cli/package.json'));
const rootPkg = readJson(path.join(root, 'package.json'));
const version = cliPkg.version || rootPkg.version || '0.1.0';

const entry = path.join(root, 'packages/cli/dist/index.js');
if (!fs.existsSync(entry)) {
  console.error('Missing packages/cli/dist/index.js — run yarn build:cli first');
  process.exit(1);
}

rimraf(outDir);
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(outDir, 'index.js'),
  banner: { js: '#!/usr/bin/env node' },
  // Keep Ink/React/dotenv as runtime deps (native-ish / large / expected peer-ish).
  external: [
    'ink',
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'dotenv',
  ],
  logLevel: 'info',
});

// Ensure shebang executable bit is preserved conceptually (npm sets on install).
const bundled = fs.readFileSync(path.join(outDir, 'index.js'), 'utf8');
if (!bundled.startsWith('#!')) {
  fs.writeFileSync(path.join(outDir, 'index.js'), '#!/usr/bin/env node\n' + bundled);
}

const require = createRequire(import.meta.url);
function depVersion(name, fallback) {
  try {
    return require(path.join(root, 'node_modules', name, 'package.json')).version;
  } catch {
    return fallback;
  }
}

const pkg = {
  name: 'maniac-agent',
  version,
  description: 'Maniac — autonomous AI agent CLI (the what the hell agent)',
  license: 'MIT',
  type: 'module',
  bin: {
    maniac: './index.js',
  },
  files: ['index.js', 'README.md', 'LICENSE'],
  engines: {
    node: '>=18',
  },
  repository: rootPkg.repository || {
    type: 'git',
    url: 'https://github.com/StillHue/maniac-agent.git',
  },
  bugs: rootPkg.bugs || { url: 'https://github.com/StillHue/maniac-agent/issues' },
  homepage: rootPkg.homepage || 'https://github.com/StillHue/maniac-agent#readme',
  keywords: ['ai', 'agent', 'cli', 'maniac', 'opencode', 'llm'],
  dependencies: {
    ink: `^${depVersion('ink', '4.4.1')}`,
    react: `^${depVersion('react', '18.2.0')}`,
    dotenv: `^${depVersion('dotenv', '16.4.5')}`,
  },
  publishConfig: {
    access: 'public',
  },
};

fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

for (const f of ['README.md', 'LICENSE']) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, f));
}

console.log(`Packed maniac-agent@${version} → ${outDir}`);

if (wantPublish) {
  const r = spawnSync('npm', ['publish', '--access', 'public'], {
    cwd: outDir,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  process.exit(r.status ?? 1);
}
