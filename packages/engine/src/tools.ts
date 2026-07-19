import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { loadCustomTools, saveCustomTools } from './tools-persistence';
import {
  immortalitySummary, getImmortalityStatus, checkResume,
  saveCheckpoint, loadCheckpoint, clearCheckpoint,
  cleanImmortalityState, reportCrash, heartbeat,
} from './immortality';

export interface ToolOutput {
  success: boolean;
  output: string;
}

export interface RegisteredTool {
  name: string;
  description: string;
  handler: (args: string, cwd: string) => ToolOutput | Promise<ToolOutput>;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv']);

// --- Resolução robusta de paths do engine (funciona em tsx, dist e Turbopack) ---

function resolveEnginePkg(): string {
  const isWin = process.platform === 'win32';

  // Estratégia 1: relativo a __dirname (funciona no tsx e no dist compilado)
  for (const rel of ['..', '.']) {
    try {
      const dir = path.resolve(__dirname, rel);
      const pkg = path.join(dir, 'package.json');
      if (fs.existsSync(pkg)) {
        const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (data.name === '@maniac/engine') return dir;
      }
    } catch {}
  }

  // Estratégia 2: relativo ao process.cwd (funciona no Turbopack/Next.js)
  const cwd = process.cwd();
  for (const rel of ['.', 'packages/engine', '..', '../packages/engine']) {
    try {
      const dir = path.resolve(cwd, rel);
      const pkg = path.join(dir, 'package.json');
      if (fs.existsSync(pkg)) {
        const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (data.name === '@maniac/engine') return dir;
      }
    } catch {}
  }

  // Estratégia 3: via require.resolve (funciona em módulos instalados)
  try {
    const resolved = require.resolve('../package.json');
    const dir = path.dirname(resolved);
    const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (data.name === '@maniac/engine') return dir;
  } catch {}

  // Fallback: assume que o cwd atual já é o package
  return cwd;
}

/** Diretório raiz do pacote engine (ex: /home/user/maniac-agent/packages/engine) */
const ENGINE_PKG = resolveEnginePkg();
/** Diretório src do engine (ex: /home/user/maniac-agent/packages/engine/src) */
const ENGINE_SRC = path.join(ENGINE_PKG, 'src');

const BUILD_CMD = process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build';

let customTools: Map<string, RegisteredTool> = new Map();

// Carrega ferramentas customizadas persistidas do disco
(function initCustomTools() {
  const persisted = loadCustomTools();
  for (const t of persisted) {
    try {
      const handler = new Function('args', 'cwd', t.handler) as (args: string, cwd: string) => ToolOutput;
      customTools.set(t.name, { name: t.name, description: t.description, handler });
    } catch (e) {
      console.warn(`[tools] Falha ao carregar tool persistida "${t.name}":`, e);
    }
  }
})();

export function registerCustomTool(name: string, description: string, handler: (args: string, cwd: string) => ToolOutput): ToolOutput {
  if (customTools.has(name)) {
    return { success: false, output: `Ferramenta "${name}" ja existe` };
  }
  customTools.set(name, { name, description, handler });
  // Persiste em disco
  const entries = [...customTools.entries()].map(([n, t]) => ({
    name: n,
    description: t.description,
    handler: t.handler.toString(),
  }));
  saveCustomTools(entries);
  return { success: true, output: `Ferramenta "${name}" registrada em tempo real e persistida` };
}

export function listCustomTools(): string {
  if (customTools.size === 0) return '';
  return [...customTools.entries()].map(([n, t]) => `  ${n}: ${t.description}`).join('\n');
}

export function reloadCustomTools(): void {
  const persisted = loadCustomTools();
  for (const t of persisted) {
    try {
      const handler = new Function('args', 'cwd', t.handler) as (args: string, cwd: string) => ToolOutput;
      if (!customTools.has(t.name)) {
        customTools.set(t.name, { name: t.name, description: t.description, handler });
      }
    } catch (e) {
      console.warn(`[tools] Falha ao recarregar tool "${t.name}":`, e);
    }
  }
}

export function toolLs(dirPath: string, cwd: string): ToolOutput {
  try {
    const resolved = path.isAbsolute(dirPath) ? dirPath : path.join(cwd, dirPath || '.');
    if (!fs.existsSync(resolved)) {
      return { success: false, output: `diretorio nao encontrado: ${dirPath}` };
    }
    const entries = fs.readdirSync(resolved);
    const dirs: string[] = [];
    const files: { name: string; size: number }[] = [];

    for (const e of entries) {
      if (IGNORED_DIRS.has(e)) continue;
      try {
        const full = path.join(resolved, e);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) dirs.push(e);
        else files.push({ name: e, size: stat.size });
      } catch {
        files.push({ name: e, size: 0 });
      }
    }

    dirs.sort();
    files.sort((a, b) => a.name.localeCompare(b.name));

    const lines = dirs.map(d => `[DIR] ${d}`);
    lines.push(...files.map(f => `[FILE] ${f.name} (${f.size}b)`));
    return { success: true, output: lines.join('\n') };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolRead(filePath: string, cwd: string): ToolOutput {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    if (!fs.existsSync(resolved)) {
      return { success: false, output: `arquivo nao encontrado: ${filePath}` };
    }
    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n');
    const maxLines = 200;
    const shown = lines.slice(0, maxLines);
    let out = shown.map((l, i) => `${i + 1}: ${l}`).join('');
    if (lines.length > maxLines) {
      out += `\n... (${lines.length - maxLines} linhas a mais)`;
    }
    return { success: true, output: out };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolWrite(filePath: string, content: string, cwd: string): ToolOutput {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
    return { success: true, output: `${path.basename(resolved)} salvo (${content.length} chars)` };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolEdit(filePath: string, oldStr: string, newStr: string, cwd: string): ToolOutput {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    if (!fs.existsSync(resolved)) {
      return { success: false, output: `arquivo nao encontrado: ${filePath}` };
    }
    let content = fs.readFileSync(resolved, 'utf8');
    const idx = content.indexOf(oldStr);
    if (idx === -1) {
      return { success: false, output: `texto antigo nao encontrado em ${filePath}` };
    }
    content = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    fs.writeFileSync(resolved, content, 'utf8');
    return { success: true, output: `${path.basename(resolved)} editado (${oldStr.length} → ${newStr.length} chars)` };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolGrep(pattern: string, searchPath: string | null, cwd: string): ToolOutput {
  try {
    const root = searchPath
      ? (path.isAbsolute(searchPath) ? searchPath : path.join(cwd, searchPath))
      : cwd;
    const results: string[] = [];
    const re = new RegExp(pattern, 'gi');

    function walk(dir: string, depth: number) {
      if (depth > 8 || results.length >= 60) return;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        if (e.startsWith('.') || e === 'node_modules') continue;
        const full = path.join(dir, e);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) walk(full, depth + 1);
          else if (stat.isFile() && stat.size < 102400) {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                re.lastIndex = 0;
                results.push(`${path.relative(root, full)}:${i + 1}  ${lines[i].trim().slice(0, 120)}`);
                if (results.length >= 60) return;
              }
            }
          }
        } catch {}
      }
    }
    walk(root, 0);
    return {
      success: true,
      output: results.length ? results.join('\n') : '(sem resultados)',
    };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolGlob(globPattern: string, searchPath: string | null, cwd: string): ToolOutput {
  try {
    const root = searchPath
      ? (path.isAbsolute(searchPath) ? searchPath : path.join(cwd, searchPath))
      : cwd;
    const results: string[] = [];
    const parts = globPattern.split('/');
    const filePattern = parts.pop()!.replace(/\*/g, '[^\\\\/]*');
    const dirRe = parts.length
      ? new RegExp('^' + parts.join('/').replace(/\*\*/g, '.*').replace(/\*/g, '[^\\\\/]*') + '$')
      : null;

    function walk(dir: string, depth: number) {
      if (depth > 10) return;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        if (e.startsWith('.') || e === 'node_modules') continue;
        const full = path.join(dir, e);
        const rel = path.relative(root, full);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            if (!dirRe || dirRe.test(rel.replace(/\\/g, '/'))) walk(full, depth + 1);
          } else if (stat.isFile()) {
            if (new RegExp(filePattern, 'i').test(e)) {
              results.push(rel);
            }
          }
        } catch {}
      }
    }
    walk(root, 0);
    return {
      success: true,
      output: results.length ? results.join('\n') : '(sem resultados)',
    };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolExec(command: string, cwd: string): ToolOutput {
  const isWin = process.platform === 'win32';

  // On Windows: PowerShell gives the best cross-compatibility.
  // Wrap the command so that non-zero exit codes surface as stderr instead of
  // throwing inside execSync (which loses the real output).
  let shell: string;
  let finalCmd: string;
  if (isWin) {
    shell = 'powershell.exe';
    // Run inside powershell with explicit error-action so we capture stderr too
    finalCmd = command;
  } else {
    shell = process.env.SHELL || '/bin/sh';
    finalCmd = command;
  }

  try {
    const stdout = execSync(finalCmd, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 60000,
      shell,
      windowsHide: true,
    }) as string;
    return { success: true, output: stdout.trim().slice(0, 4000) };
  } catch (e: any) {
    const out = (e.stdout?.trim() || '') + (e.stderr?.trim() ? '\n' + e.stderr.trim() : '');
    return {
      success: false,
      output: (out || e.message).slice(0, 2000),
    };
  }
}

const WINDOWS_EXEC_BRIDGE = 'http://100.91.227.9:8081/exec';

export async function toolWindowsExec(command: string): Promise<ToolOutput> {
  try {
    const cmd = command.trim();
    if (!cmd) {
      return { success: false, output: 'comando vazio' };
    }

    const res = await fetch(WINDOWS_EXEC_BRIDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, gui: false }),
    });

    const text = await res.text();
    try {
      const body = JSON.parse(text) as { success?: boolean; output?: string };
      if (typeof body.success === 'boolean' && typeof body.output === 'string') {
        return {
          success: body.success,
          output: body.output.trim().slice(0, 4000),
        };
      }
    } catch {}

    if (!res.ok) {
      return { success: false, output: text.trim().slice(0, 4000) || `HTTP ${res.status}` };
    }
    return { success: true, output: text.trim().slice(0, 4000) };
  } catch (e: any) {
    return { success: false, output: `Erro no bridge Windows: ${e.message}` };
  }
}

const BRAIN_VAULT = process.env.MANIAC_BRAIN_VAULT || path.join(require('os').homedir(), '.maniac', 'brain');

export function toolBrainRead(args: string): ToolOutput {
  try {
    const query = args.trim().toLowerCase();
    if (!fs.existsSync(BRAIN_VAULT)) {
      return { success: false, output: 'Vault nao encontrado' };
    }
    const files = fs.readdirSync(BRAIN_VAULT).filter(f => f.endsWith('.md'));

    if (!query || query === '*' || query === 'all') {
      const list = files.sort().reverse().slice(0, 40).join('\n');
      return { success: true, output: `Notas no cofre (${files.length} total):\n${list}` };
    }

    const results: { file: string; score: number; snippet: string }[] = [];
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(BRAIN_VAULT, f), 'utf8');
        const lower = content.toLowerCase();
        let score = 0;
        const words = query.split(/\s+/);
        for (const w of words) {
          if (w.length < 3) continue;
          const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          const matches = lower.match(re);
          if (matches) score += matches.length * 10;
          if (f.toLowerCase().includes(w)) score += 50;
        }
        if (score > 0) {
          const lines = content.split('\n');
          const firstLine = lines.find(l => l.startsWith('# ')) || f;
          const snippet = lines.slice(1, 5).join(' ').trim().slice(0, 200);
          results.push({ file: f, score, snippet: `${firstLine}\n${snippet}` });
        }
      } catch {}
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, 10);
    if (top.length === 0) return { success: true, output: 'Nada encontrado no cofre' };

    const out = top.map(r => {
      const link = r.file.replace('.md', '');
      return `[[${link}]] (${r.score}pts)\n  ${r.snippet.slice(0, 150)}`;
    }).join('\n\n');
    return { success: true, output: out };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolBrainSave(args: string): ToolOutput {
  try {
    let title: string;
    let content: string;
    let tags = 'maniac,auto-salvo';

    if (args.trim().startsWith('{')) {
      const parsed = JSON.parse(args);
      title = parsed.title || 'Nota sem titulo';
      content = parsed.content || parsed.body || '';
      tags = parsed.tags || tags;
    } else {
      const sep = args.indexOf('\n');
      if (sep === -1) {
        const pipeIdx = args.indexOf('|');
        if (pipeIdx === -1) return { success: false, output: 'formato: titulo\nconteudo' };
        title = args.slice(0, pipeIdx).trim();
        content = args.slice(pipeIdx + 1).trim();
      } else {
        title = args.slice(0, sep).trim();
        content = args.slice(sep + 1).trim();
      }
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúãõâêôç\s]/gi, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60);

    const filename = `${dateStr}-${slug}.md`;
    const filepath = path.join(BRAIN_VAULT, filename);

    const frontmatter = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `created: ${now.toISOString()}`,
      `tags: [${tags.split(',').map(t => `"${t.trim()}"`).join(', ')}]`,
      '---',
    ].join('\n');

    const md = `${frontmatter}\n\n# ${title}\n\n${content}\n`;
    fs.writeFileSync(filepath, md, 'utf8');

    return { success: true, output: `Salvo em [[${filename.replace('.md', '')}]] (${content.length} chars)` };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export function toolSourceEdit(filePath: string, oldString: string, newString: string): ToolOutput {
  try {
    // Resolve caminhos relativos de forma inteligente:
    // - "src/*" ou "dist/*" → resolve relativo à raiz do package
    // - demais paths → resolve relativo ao ENGINE_SRC
    let resolved: string;
    if (filePath.startsWith('src/') || filePath.startsWith('dist/')) {
      resolved = path.resolve(ENGINE_PKG, filePath);
    } else {
      resolved = path.resolve(ENGINE_SRC, filePath);
    }

    const resolvedPath = path.resolve(resolved);
    if (!resolvedPath.startsWith(ENGINE_PKG)) {
      return { success: false, output: `Acesso negado: "${filePath}" fora do pacote engine` };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, output: `Arquivo nao encontrado: ${path.relative(ENGINE_PKG, resolvedPath)}` };
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const idx = content.indexOf(oldString);
    if (idx === -1) {
      return { success: false, output: `Texto antigo nao encontrado em ${path.relative(ENGINE_PKG, resolvedPath)}` };
    }
    const updated = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
    const backupPath = resolvedPath + '.bak';
    fs.writeFileSync(backupPath, content, 'utf8');
    fs.writeFileSync(resolvedPath, updated, 'utf8');
    return {
      success: true,
      output: `${path.relative(ENGINE_PKG, resolvedPath)} modificado (${oldString.length} → ${newString.length} chars)\nBackup: ${path.relative(ENGINE_PKG, backupPath)}\nExecute [TOOL:rebuild_engine] para aplicar as mudancas`,
    };
  } catch (e: any) {
    return { success: false, output: `Erro ao editar fonte: ${e.message}` };
  }
}

export function toolCreateTool(args: string, cwd: string): ToolOutput {
  try {
    const pipeIdx = args.indexOf('|');
    const braceIdx = args.indexOf('{');
    let name: string, description: string, code: string;

    if (braceIdx !== -1 && (pipeIdx === -1 || braceIdx < pipeIdx)) {
      const parsed = JSON.parse(args);
      name = parsed.name;
      description = parsed.description || 'Ferramenta dinamica';
      code = parsed.code || parsed.handler || '';
      if (!name) return { success: false, output: 'Campo "name" obrigatorio' };
    } else {
      const parts = args.split('|').map(s => s.trim());
      if (parts.length < 3) {
        return { success: false, output: 'formato: nome|descricao|handler_code (ou JSON com name, description, code)' };
      }
      name = parts[0];
      description = parts[1];
      code = parts.slice(2).join('|');
    }

    const handler = new Function('args', 'cwd', code) as (args: string, cwd: string) => ToolOutput;

    const testResult = handler('test', cwd);
    if (!testResult || typeof testResult.success !== 'boolean') {
      return { success: false, output: 'Handler nao retornou ToolOutput valido { success, output }' };
    }

    return registerCustomTool(name, description, handler);
  } catch (e: any) {
    return { success: false, output: `Erro ao criar ferramenta: ${e.message}` };
  }
}

export function toolModelSwitch(args: string): ToolOutput {
  try {
    let provider: string, model: string;
    const pipeIdx = args.indexOf('|');
    if (pipeIdx !== -1) {
      provider = args.slice(0, pipeIdx).trim();
      model = args.slice(pipeIdx + 1).trim();
    } else {
      provider = args.trim();
      model = args.includes('opencode') ? 'north-mini-code-free'
        : args.includes('groq') ? 'llama-3.1-8b-instant'
        : args.includes('gemini') ? 'gemini-2.0-flash'
        : 'north-mini-code-free';
    }

    const { setActiveProvider, getActiveProvider } = require('./opencode');
    setActiveProvider({ provider: provider as any, model });
    const cfg = getActiveProvider();
    return { success: true, output: `Modelo alterado: ${cfg.provider}/${cfg.model}` };
  } catch (e: any) {
    return { success: false, output: `Erro ao trocar modelo: ${e.message}` };
  }
}

export function toolSystemPromptEdit(args: string): ToolOutput {
  try {
    const parts = args.split('\n---\n').map(s => s.trim());
    if (parts.length < 2) {
      return { success: false, output: 'formato: texto_antigo\n---\nnovo_texto' };
    }
    const routerPath = path.join(ENGINE_SRC, 'router.ts');
    if (!fs.existsSync(routerPath)) {
      return { success: false, output: `router.ts nao encontrado em ${routerPath}. ENGINE_SRC=${ENGINE_SRC}` };
    }

    const content = fs.readFileSync(routerPath, 'utf8');
    const oldStr = parts[0];
    const newStr = parts[1];
    const idx = content.indexOf(oldStr);
    if (idx === -1) {
      return { success: false, output: 'Texto nao encontrado no system prompt. Use source_edit para mudancas mais precisas.' };
    }

    const backupPath = routerPath + '.bak';
    fs.writeFileSync(backupPath, content, 'utf8');
    const updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    fs.writeFileSync(routerPath, updated, 'utf8');
    return {
      success: true,
      output: `System prompt editado (${oldStr.length} → ${newStr.length} chars)\nExecute [TOOL:rebuild_engine] para aplicar`,
    };
  } catch (e: any) {
    return { success: false, output: `Erro ao editar system prompt: ${e.message}` };
  }
}

export function toolRebuildEngine(_cwd: string): ToolOutput {
  try {
    const pkgDir = ENGINE_PKG;
    const pkgPath = path.join(pkgDir, 'package.json');
    const buildScript = (fs.existsSync(pkgPath) && JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts?.build) || 'tsc';
    const result = toolExec(`npm run build`, pkgDir);
    if (!result.success) {
      return { success: false, output: `Build falhou:\n${result.output}` };
    }
    return { success: true, output: `Engine rebuilded com sucesso em ${pkgDir}.\nReinicie o processo para carregar as mudancas.` };
  } catch (e: any) {
    return { success: false, output: `Erro no rebuild: ${e.message}` };
  }
}

export function toolSpawnTerminal(args: string, cwd: string): ToolOutput {
  try {
    const lines = args.split('\n').map(s => s.trim()).filter(Boolean);
    const command = lines[0] || 'cmd.exe';
    const cmdArgs = lines.slice(1);

    const isWin = process.platform === 'win32';
    if (isWin) {
      const fullCmd = `${command} ${cmdArgs.join(' ')}`;
      execSync(`start "${command}" ${fullCmd}`, { cwd, shell: 'cmd.exe', timeout: 5000 });
      return { success: true, output: `Terminal aberto: ${fullCmd}` };
    }
    const child = spawn('x-terminal-emulator', ['-e', command, ...cmdArgs], {
      cwd, detached: true, stdio: 'ignore',
    });
    child.unref();
    return { success: true, output: `Terminal aberto: ${command} ${cmdArgs.join(' ')} (PID ${child.pid})` };
  } catch (e: any) {
    return { success: false, output: `Erro ao abrir terminal: ${e.message}` };
  }
}

export function toolServerStart(args: string, cwd: string): ToolOutput {
  try {
    const port = parseInt(args.trim(), 10) || 3130;

    // Procura o server.js em múltiplos locais (evita __dirname direto para compatibilidade com Turbopack)
    const candidates: string[] = [
      path.join(cwd, 'packages', 'engine', 'dist', 'server.js'),
      path.join(cwd, 'dist', 'server.js'),
      path.join(cwd, 'server.ts'),
    ];

    // Tenta resolver via require.resolve como fallback runtime
    try {
      const resolved = require.resolve('../dist/server.js');
      if (resolved) candidates.push(resolved);
    } catch {}

    for (const sp of candidates) {
      if (!fs.existsSync(sp)) continue;
      const isTs = sp.endsWith('.ts');
      const child = spawn(isTs ? 'npx' : 'node', isTs ? ['tsx', sp] : [sp], {
        cwd, detached: true, stdio: 'ignore',
        env: { ...process.env, ARES_PORT: String(port) },
      });
      child.unref();
      return { success: true, output: `Servidor maniac iniciado em http://localhost:${port} (PID ${child.pid})${isTs ? ', modo tsx' : ''}` };
    }

    return { success: false, output: 'server.ts ou dist/server.js nao encontrado' };
  } catch (e: any) {
    return { success: false, output: `Erro ao iniciar servidor: ${e.message}` };
  }
}

export function toolServerStatus(): ToolOutput {
  try {
    const pidPath = PID_FILE;
    if (fs.existsSync(pidPath)) {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
      try {
        process.kill(pid, 0);
        return { success: true, output: `Servidor maniac ativo (PID ${pid})` };
      } catch {
        return { success: true, output: `PID file existe mas processo ${pid} nao esta rodando. Execute [TOOL:server_start] para reanimar.` };
      }
    }
    return { success: true, output: 'Nenhum servidor maniac rodando. Execute [TOOL:server_start] para iniciar.' };
  } catch (e: any) {
    return { success: false, output: `Erro: ${e.message}` };
  }
}

export function toolSelfRestart(args: string, cwd: string): ToolOutput {
  try {
    const reason = args.trim() || 'auto-restart apos modificacao';
    const pidPath = PID_FILE;

    const script = process.argv[1];
    const execPath = process.execPath;
    const env = { ...process.env, ARES_RESTART_REASON: reason, ARES_RESTART_COUNT: String(parseInt(process.env.ARES_RESTART_COUNT || '0', 10) + 1) };

    const isWin = process.platform === 'win32';
    if (isWin) {
      const cmd = `start /B "" "${execPath}" "${script}" "${process.argv.slice(2).join('" "')}"`;
      execSync(cmd, { cwd, shell: 'cmd.exe', env, timeout: 5000 });
    } else {
      const child = spawn(execPath, process.argv.slice(1), {
        cwd, detached: true, stdio: 'ignore', env,
      });
      child.unref();
    }

    if (fs.existsSync(pidPath)) {
      try { fs.unlinkSync(pidPath); } catch {}
    }

    setTimeout(() => process.exit(0), 500);
    return { success: true, output: `Reiniciando (${reason}). Novo processo lancado.` };
  } catch (e: any) {
    return { success: false, output: `Erro ao reiniciar: ${e.message}` };
  }
}

const PID_FILE = path.join(ENGINE_PKG, '..', '..', '.maniac.pid');

// ─── Ferramentas de Imortalidade ──────────────────────────────────────────

export function toolImmortalitySave(args: string): ToolOutput {
  try {
    // args opcional: descrição do que está sendo feito
    const description = args.trim() || 'checkpoint manual';
    saveCheckpoint({
      messages: [],
      mode: 'chat',
      lastUserMessage: description,
      lastAssistantReply: '',
      toolExecutionIndex: 0,
      totalToolExecutions: 1,
    });
    heartbeat('running');
    return { success: true, output: `Checkpoint salvo: ${description}\n${immortalitySummary()}` };
  } catch (e: any) {
    return { success: false, output: `Erro ao salvar checkpoint: ${e.message}` };
  }
}

export function toolImmortalityStatus(): ToolOutput {
  try {
    const status = getImmortalityStatus();
    const resume = checkResume();
    const lines: string[] = [
      '=== STATUS DE IMORTALIDADE ===',
      `✅ Vivo: ${status.alive ? 'sim' : 'não'}`,
      `📡 Heartbeat: ${status.heartbeatAge >= 0 ? `${(status.heartbeatAge / 1000).toFixed(1)}s atrás` : 'nunca'}`,
      `💾 Checkpoint: ${status.hasCheckpoint ? `${(status.checkpointAge / 1000).toFixed(1)}s atrás` : 'nenhum'}`,
      `🆔 Session: ${status.sessionId}`,
      `⚙️  PID: ${status.processId}`,
      `🔄 Pode retomar: ${resume.shouldResume ? 'sim' : 'não'}`,
    ];
    if (resume.crashReport) {
      const cr = resume.crashReport;
      lines.push(`\n☠️ ÚLTIMO CRASH:`);
      lines.push(`   Erro: ${cr.error}`);
      lines.push(`   Quando: ${new Date(cr.timestamp).toISOString()}`);
      if (cr.stack) lines.push(`   Stack: ${cr.stack.slice(0, 200)}`);
    }
    return { success: true, output: lines.join('\n') };
  } catch (e: any) {
    return { success: false, output: `Erro ao obter status: ${e.message}` };
  }
}

export function toolImmortalityResume(): ToolOutput {
  try {
    const resume = checkResume();
    if (!resume.shouldResume) {
      return { success: true, output: 'Nada para retomar. Estado limpo.' };
    }

    const cp = resume.checkpoint;
    const output: string[] = [
      '=== RETOMANDO DE CHECKPOINT ===',
      `Sessão anterior: ${cp?.environment.processId || 'desconhecido'}`,
      `Host: ${cp?.environment.hostname || 'desconhecido'}`,
      `Timestamp: ${cp?.timestamp ? new Date(cp.timestamp).toISOString() : 'desconhecido'}`,
      `Modo: ${cp?.session.mode || 'chat'}`,
      `Mensagens no histórico: ${cp?.session.messages.length || 0}`,
      `Última mensagem do usuário: ${(cp?.session.lastUserMessage || '').slice(0, 100)}`,
      `Última resposta: ${(cp?.session.lastAssistantReply || '').slice(0, 100)}`,
    ];

    if (resume.crashReport) {
      output.push(`\n☠️ CAUSA DA MORTE: ${resume.crashReport.error}`);
    }

    // Se havia checkpoint e queremos retomar, mantemos o checkpoint para o caller
    return { success: true, output: output.join('\n') };
  } catch (e: any) {
    return { success: false, output: `Erro ao verificar resume: ${e.message}` };
  }
}

export function toolImmortalityForget(): ToolOutput {
  try {
    cleanImmortalityState();
    return { success: true, output: 'Estado de imortalidade limpo. Checkpoint, heartbeat e crash report removidos.' };
  } catch (e: any) {
    return { success: false, output: `Erro ao limpar estado: ${e.message}` };
  }
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org';

function tgApiCall(method: string, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN) return reject(new Error('TELEGRAM_BOT_TOKEN nao configurado'));
    const b = JSON.stringify(body);
    const u = new URL(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/${method}`);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) },
    };
    const r = require('https').request(opts, (res: any) => {
      let d = ''; res.on('data', (c: string) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, description: d.slice(0, 200) }); } });
    });
    r.on('error', reject); r.write(b); r.end();
  });
}

export async function toolSendTelegram(args: string): Promise<ToolOutput> {
  try {
    const parsed = JSON.parse(args);
    const to = parsed.to || parsed.chat_id || parsed.target;
    const text = parsed.text || parsed.message;
    const editMessageId = parsed.edit_message_id;
    if (!to || !text) {
      return { success: false, output: 'formato: {"to": "@username ou chat_id", "text": "mensagem"}' };
    }
    let chatId = to;
    if (chatId.startsWith('@') || !/^\d+$/.test(chatId)) {
      const updates = await tgApiCall('getUpdates', { timeout: 5 });
      const username = chatId.replace('@', '').toLowerCase();
      for (const u of updates.result || []) {
        const from = u.message?.from || u.my_chat_member?.from || u.chat_join_request?.from;
        if (from && from.username && from.username.toLowerCase() === username) {
          chatId = String(u.message?.chat?.id || from.id);
          break;
        }
      }
      if (chatId === to) {
        return { success: false, output: `Usuario @${username} nao encontrado. Use telegram_list_chats para ver contatos disponiveis.` };
      }
    }
    const chatIdNum = parseInt(chatId);
    if (editMessageId) {
      const result = await tgApiCall('editMessageText', { chat_id: chatIdNum, message_id: editMessageId, text, parse_mode: 'Markdown' });
      if (result.ok) {
        return { success: true, output: `Mensagem editada (message_id: ${editMessageId})` };
      }
      return { success: false, output: result.description || 'Erro ao editar mensagem Telegram' };
    }
    const result = await tgApiCall('sendMessage', { chat_id: chatIdNum, text, parse_mode: 'Markdown' });
    if (result.ok) {
      const msgId = result.result?.message_id;
      return { success: true, output: `Mensagem enviada para ${to} (chat_id: ${chatId})${msgId ? `, message_id: ${msgId}` : ''}` };
    }
    return { success: false, output: result.description || 'Erro Telegram' };
  } catch (e: any) {
    return { success: false, output: `Erro Telegram: ${e.message}` };
  }
}

export async function toolTelegramListChats(): Promise<ToolOutput> {
  try {
    const data = await tgApiCall('getUpdates', { timeout: 5 });
    const seen: Record<number, boolean> = {};
    const chats: { id: number; name: string; username: string }[] = [];
    for (const u of data.result || []) {
      const from = u.message?.from || u.my_chat_member?.from || u.chat_join_request?.from;
      if (from && !seen[from.id]) {
        seen[from.id] = true;
        const chat = u.message?.chat || from;
        chats.push({
          id: chat.id || from.id,
          name: [chat.first_name || '', chat.last_name || ''].filter(Boolean).join(' ') || chat.title || '?',
          username: from.username ? '@' + from.username : '',
        });
      }
    }
    if (chats.length === 0) return { success: true, output: 'Nenhum chat encontrado. Envie uma mensagem para o bot primeiro.' };
    const lines = chats.map(c => `  ${c.id} | ${c.name} ${c.username}`).join('\n');
    return { success: true, output: `Chats disponiveis:\n${lines}\n\nUse [TOOL:send_telegram] {"to": "id_ou_@username", "text": "msg"}` };
  } catch (e: any) {
    return { success: false, output: `Erro: ${e.message}` };
  }
}

export async function executeToolCall(
  type: string,
  command: string,
  cwd: string
): Promise<ToolOutput> {
  const parts = command.split(/\s+/);

  if (customTools.has(type)) {
    return await customTools.get(type)!.handler(command, cwd);
  }

  switch (type) {
    case 'ls':
      return toolLs(command, cwd);
    case 'read':
      return toolRead(command, cwd);
    case 'write': {
      const sep = command.indexOf('\n');
      if (sep === -1) return { success: false, output: 'formato: caminho\nconteudo' };
      const filePath = command.slice(0, sep).trim();
      const content = command.slice(sep + 1).trim();
      return toolWrite(filePath, content, cwd);
    }
    case 'edit': {
      const editParts = command.split('---').map(s => s.trim());
      if (editParts.length < 3) {
        return { success: false, output: 'formato: caminho\n---\ntexto antigo\n---\nnovo texto' };
      }
      return toolEdit(editParts[0], editParts[1], editParts.slice(2).join('---'), cwd);
    }
    case 'grep': {
      const pattern = parts[0];
      const searchPath = parts.slice(1).join(' ') || null;
      return toolGrep(pattern, searchPath, cwd);
    }
    case 'glob': {
      const gpattern = parts[0];
      const searchPath = parts.slice(1).join(' ') || null;
      return toolGlob(gpattern, searchPath, cwd);
    }
    case 'exec':
      return toolExec(command, cwd);
    case 'windows_exec':
      return await toolWindowsExec(command);
    case 'brain':
      return toolBrainSave(command);
    case 'source_edit': {
      const sepIdx = command.indexOf('\n---\n');
      if (sepIdx === -1) return { success: false, output: 'formato: caminho/arquivo.ts\n---\ntexto_antigo\n---\nnovo_texto' };
      const filePath = command.slice(0, sepIdx).trim();
      const rest = command.slice(sepIdx + 5).trim();
      const secondSep = rest.indexOf('\n---\n');
      if (secondSep === -1) return { success: false, output: 'formato: caminho/arquivo.ts\n---\ntexto_antigo\n---\nnovo_texto' };
      const oldStr = rest.slice(0, secondSep).trim();
      const newStr = rest.slice(secondSep + 5).trim();
      return toolSourceEdit(filePath, oldStr, newStr);
    }
    case 'tool_create':
      return toolCreateTool(command, cwd);
    case 'model_switch':
      return toolModelSwitch(command);
    case 'system_prompt_edit':
      return toolSystemPromptEdit(command);
    case 'rebuild_engine':
      return toolRebuildEngine(cwd);
    case 'custom_tools_list': {
      const custom = listCustomTools();
      return { success: true, output: custom || 'Nenhuma ferramenta customizada registrada' };
    }
    case 'spawn_terminal':
      return toolSpawnTerminal(command, cwd);
    case 'server_start':
      return toolServerStart(command, cwd);
    case 'server_status':
      return toolServerStatus();
    case 'self_restart':
      return toolSelfRestart(command, cwd);
    case 'send_telegram':
      return await toolSendTelegram(command);
    case 'telegram_list_chats':
      return await toolTelegramListChats();
    case 'immortality_save':
      return toolImmortalitySave(command);
    case 'immortality_status':
      return toolImmortalityStatus();
    case 'immortality_resume':
      return toolImmortalityResume();
    case 'immortality_forget':
      return toolImmortalityForget();
    default:
      return { success: false, output: `ferramenta desconhecida: ${type}` };
  }
}

export function parseToolCalls(text: string): { type: string; command: string }[] {
  const tools: { type: string; command: string }[] = [];

  // Format 1 (native): [TOOL:name]args[/TOOL]  or  TOOL:name]args[/TOOL]
  const re1 = /\[?TOOL:([\w\/]+)\]\s*([\s\S]*?)\s*\[\/TOOL\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) {
    tools.push({ type: m[1].toLowerCase(), command: m[2].trim() });
  }

  // Format 2 (function-call XML): <tool_call>\s*<function=name>\s*<parameter=*>args</parameter>\s*</function>\s*</tool_call>
  const re2 = /<tool_call>\s*<function=([\w\/]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/gi;
  while ((m = re2.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    // Extract all <parameter=*>value</parameter> blocks and join as the command
    const inner = m[2];
    const params: string[] = [];
    const reParam = /<parameter[^>]*>([\s\S]*?)<\/parameter>/gi;
    let p: RegExpExecArray | null;
    while ((p = reParam.exec(inner)) !== null) {
      params.push(p[1].trim());
    }
    tools.push({ type: name, command: params.join('\n') || inner.trim() });
  }

  // Format 3 (markdown code block): ```tool_call\nexec\ncommand\n```
  const re3 = /```tool_call\s+([\w\/]+)\s*\n([\s\S]*?)```/gi;
  while ((m = re3.exec(text)) !== null) {
    tools.push({ type: m[1].toLowerCase(), command: m[2].trim() });
  }

  // Format 4 (JSON function call): {"name":"exec","parameters":{"command":"..."}}
  const re4 = /\{"name"\s*:\s*"([\w\/]+)"\s*,\s*"(?:parameters|arguments)"\s*:\s*(\{[\s\S]*?\})\}/gi;
  while ((m = re4.exec(text)) !== null) {
    try {
      const args = JSON.parse(m[2]);
      const cmd = args.command ?? args.cmd ?? args.path ?? JSON.stringify(args);
      tools.push({ type: m[1].toLowerCase(), command: typeof cmd === 'string' ? cmd : JSON.stringify(cmd) });
    } catch {}
  }

  return tools;
}

export function stripToolCalls(text: string): string {
  return text
    .replace(/\[?TOOL:[\w\/]+\]\s*[\s\S]*?\s*\[\/TOOL\]/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/```tool_call[\s\S]*?```/gi, '')
    .replace(/\{"name"\s*:\s*"[\w\/]+"\s*,\s*"(?:parameters|arguments)"\s*:\s*\{[\s\S]*?\}\}/gi, '')
    .trim();
}
