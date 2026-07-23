#!/usr/bin/env node
/**
 * Bundle the CLI + engine + types into a single npm-publishable package
 * named `maniac-agent` (bin: maniac). Works with npm and bun.
 *
 * Usage (from repo root, after yarn build:cli):
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
const nodeRequire = createRequire(import.meta.url);

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

function depVersion(name, fallback) {
  const candidates = [
    path.join(root, 'packages/cli/node_modules', name, 'package.json'),
    path.join(root, 'node_modules', name, 'package.json'),
  ];
  for (const p of candidates) {
    try {
      return nodeRequire(p).version;
    } catch {
      /* next */
    }
  }
  return fallback;
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
const bundledPath = path.join(packDir, 'maniac.js');

// Keep ink/react external: ink pulls yoga-wasm (TLA). Bundling that into the same
// ESM file as engine's __dirname triggers Node ERR_AMBIGUOUS_MODULE_SYNTAX.
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundledPath,
  external: [
    'ink',
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'dotenv',
  ],
  logLevel: 'info',
});

let bundled = fs.readFileSync(bundledPath, 'utf8');
bundled = bundled.replace(/^\uFEFF/, '').replace(/^(#!.*\r?\n)+/, '');

// 1) createRequire — esbuild's __require prefers a real require when present
// 2) __filename/__dirname — engine CJS helpers still reference them
const prelude = `#!/usr/bin/env node
import { createRequire as __maniacCreateRequire } from 'module';
import { fileURLToPath as __maniacFileURLToPath } from 'url';
import { dirname as __maniacDirname } from 'path';
const require = __maniacCreateRequire(import.meta.url);
const __filename = __maniacFileURLToPath(import.meta.url);
const __dirname = __maniacDirname(__filename);
`;

fs.writeFileSync(bundledPath, prelude + bundled, 'utf8');

const shebangLines = (fs.readFileSync(bundledPath, 'utf8').match(/^#!/gm) || []).length;
if (shebangLines !== 1) {
  console.error(`Expected exactly 1 shebang, found ${shebangLines}`);
  process.exit(1);
}

const inkVer = depVersion('ink', '4.4.1');
let reactVer = depVersion('react', '18.3.1');
if (parseInt(String(reactVer).split('.')[0], 10) >= 19) reactVer = '18.3.1';
const dotenvVer = depVersion('dotenv', '16.4.5');

const pkg = {
  name: 'maniac-agent',
  version,
  description: 'Maniac - autonomous AI agent CLI (the what the hell agent)',
  license: 'MIT',
  type: 'module',
  bin: {
    maniac: 'maniac.js',
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
    ink: `^${inkVer}`,
    // Ink 4 requires React 18 — never publish a hoisted React 19 from the web app.
    react: `^${reactVer}`,
    dotenv: `^${dotenvVer}`,
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
