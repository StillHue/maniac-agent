#!/usr/bin/env node
/**
 * Bundle the CLI + engine + types into a single npm-publishable package
 * named `maniac-agent` (bin: maniac). Works with npm and bun.
 *
 * Usage (from repo root, after yarn build:all && yarn build:cli):
 *   node scripts/pack-npm.mjs
 *   node scripts/pack-npm.mjs --publish
 *
 * Prints the pack directory as the last line: PACK_DIR=<path>
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const wantPublish = process.argv.includes('--publish');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function resolvePackDir() {
  const preferred = path.join(root, 'dist-npm');
  try {
    fs.rmSync(preferred, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const alt = path.join(root, `dist-npm-${process.pid}`);
    fs.rmSync(alt, { recursive: true, force: true });
    fs.mkdirSync(alt, { recursive: true });
    console.warn(`dist-npm locked — packing into ${alt}`);
    return alt;
  }
}

const cliPkg = readJson(path.join(root, 'packages/cli/package.json'));
const rootPkg = readJson(path.join(root, 'package.json'));
const version = cliPkg.version || rootPkg.version || '0.1.0';

const entry = path.join(root, 'packages/cli/dist/index.js');
if (!fs.existsSync(entry)) {
  console.error('Missing packages/cli/dist/index.js — run yarn build:cli first');
  process.exit(1);
}

const packDir = resolvePackDir();

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(packDir, 'maniac.js'),
  banner: { js: '#!/usr/bin/env node' },
  external: [
    'ink',
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'dotenv',
  ],
  logLevel: 'info',
});

const bundledPath = path.join(packDir, 'maniac.js');
const bundled = fs.readFileSync(bundledPath, 'utf8');
if (!bundled.startsWith('#!')) {
  fs.writeFileSync(bundledPath, '#!/usr/bin/env node\n' + bundled);
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
    maniac: './maniac.js',
  },
  files: ['maniac.js', 'README.md', 'LICENSE'],
  engines: {
    node: '>=18',
  },
  repository: rootPkg.repository || {
    type: 'git',
    url: 'git+https://github.com/StillHue/maniac-agent.git',
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

fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

for (const f of ['README.md', 'LICENSE']) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(packDir, f));
}

console.log(`Packed maniac-agent@${version} → ${packDir}`);
console.log(`PACK_DIR=${packDir}`);

if (wantPublish) {
  const r = spawnSync('npm', ['publish', '--access', 'public'], {
    cwd: packDir,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  process.exit(r.status ?? 1);
}
