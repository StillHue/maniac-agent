import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const KEY = 'C:\\Users\\gabdr\\ares\\goose-agent-key-fixed.pem';
const HOST = '54.82.44.39';
const USER = 'ubuntu';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.error) { console.error(`\nERRO: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0) { console.error(`\nERRO: ${cmd} exit code ${r.status}`); process.exit(r.status); }
}

function runOut(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, encoding: 'utf-8', ...opts });
  if (r.error) { console.error(`ERRO: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    console.error(`\nERRO: ${cmd} exit code ${r.status}`);
    process.exit(r.status);
  }
  return r.stdout.trim();
}

function banner(msg) {
  console.log('\n' + '='.repeat(50));
  console.log(`  ${msg}`);
  console.log('='.repeat(50));
}

async function main() {
  if (!existsSync(KEY)) {
    console.error(`ERRO: Chave SSH não encontrada em ${KEY}`);
    console.error('Ajusta o caminho no script se necessário.');
    process.exit(1);
  }

  // 1. Build the engine
  banner('BUILDANDO ENGINE');
  run('yarn', ['workspace', '@maniac/types', 'build'], { cwd: ROOT });
  run('yarn', ['workspace', '@maniac/engine', 'build'], { cwd: ROOT });

  // 2. Copy dist files to EC2
  banner('ENVIANDO DIST PARA EC2');
  const distDir = join(ROOT, 'packages', 'engine', 'dist');
  const remoteDir = '/home/ubuntu/ares/packages/engine/dist/';

  // Create remote dir and copy files
  runOut('ssh', [
    '-i', KEY, '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    `${USER}@${HOST}`,
    `mkdir -p ${remoteDir}`
  ]);

  const files = ['index.js', 'engine.js', 'proactive.js', 'compressor.js', 'curator.js',
    'delegation.js', 'immortality.js', 'memory.js', 'opencode.js', 'review.js', 'router.js', 'server.js',
    'skills.js', 'tools.js', 'tool-catalog.js', 'tools-persistence.js',
    'index.d.ts', 'engine.d.ts', 'proactive.d.ts', 'compressor.d.ts', 'curator.d.ts',
    'delegation.d.ts', 'immortality.d.ts', 'memory.d.ts', 'opencode.d.ts', 'review.d.ts', 'router.d.ts',
    'server.d.ts', 'skills.d.ts', 'tools.d.ts', 'tool-catalog.d.ts', 'tools-persistence.d.ts'];

  for (const f of files) {
    const local = join(distDir, f);
    if (!existsSync(local)) continue;
    console.log(`  -> ${f}`);
    runOut('scp', [
      '-i', KEY, '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      local,
      `${USER}@${HOST}:${remoteDir}`
    ]);
  }

  // Also copy types dist (needed for compilation references)
  const typesDistDir = join(ROOT, 'packages', 'types', 'dist');
  const remoteTypesDir = '/home/ubuntu/ares/packages/types/dist/';
  if (existsSync(typesDistDir)) {
    runOut('ssh', [
      '-i', KEY, '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      `${USER}@${HOST}`,
      `mkdir -p ${remoteTypesDir}`
    ]);
    for (const f of ['index.js', 'index.d.ts']) {
      const local = join(typesDistDir, f);
      if (!existsSync(local)) continue;
      console.log(`  -> types/${f}`);
      runOut('scp', [
        '-i', KEY, '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        local,
        `${USER}@${HOST}:${remoteTypesDir}`
      ]);
    }
  }

  // 3. Restart ec2-bot
  banner('REINICIANDO EC2-BOT');
  try {
    runOut('ssh', [
      '-i', KEY, '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      `${USER}@${HOST}`,
      'sudo systemctl daemon-reload && sudo systemctl restart ec2-bot'
    ]);
    console.log('  ec2-bot reiniciado com sucesso');
  } catch {
    console.log('  aviso: nao foi possivel reiniciar o servico (pode ser sudo sem password)');
  }

  // 4. Check status
  banner('STATUS');
  try {
    const status = runOut('ssh', [
      '-i', KEY, '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      `${USER}@${HOST}`,
      'sudo systemctl status ec2-bot 2>&1 | head -8'
    ]);
    console.log(status);
  } catch {
    console.log('  nao foi possivel verificar status');
  }

  console.log('\n✅ Deploy concluido!');
}

main().catch(console.error);
