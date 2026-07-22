import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MEMORY_DIR = process.env.MANIAC_MEMORY_DIR
  || (process.env.ARES_BRAIN_DIR ? path.join(process.env.ARES_BRAIN_DIR, '_Maniac') : null)
  || path.join(os.homedir(), '.maniac', 'memory');

const MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md');
const USER_FILE = path.join(MEMORY_DIR, 'USER.md');

const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;

export interface MemorySnapshot {
  memory: string;
  user: string;
}

function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readOrInit(filePath: string, label: string): string {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.debug('[memory] readOrInit falhou:', e);
  }
  const header = `# ${label}\n\n`;
  atomicWrite(filePath, header);
  return header;
}

export function getMemorySnapshot(): MemorySnapshot {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  return {
    memory: readOrInit(MEMORY_FILE, 'MEMÓRIA — Fatos, Preferências, Conhecimento do Maniac'),
    user: readOrInit(USER_FILE, 'PERFIL — Preferências, Estilo, Expectativas do Usuário'),
  };
}

export function buildMemoryBlock(snapshot: MemorySnapshot): string {
  const mem = snapshot.memory.trim();
  const usr = snapshot.user.trim();
  const blocks: string[] = [];
  if (mem && mem.length > 10) blocks.push(mem);
  if (usr && usr.length > 10) blocks.push(usr);
  if (blocks.length === 0) return '';
  return `\n---\n## Memória Persistente (segundo cérebro)\n\n${blocks.join('\n\n')}\n---\n`;
}

export function saveMemory(content: string): { success: boolean; output: string } {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    let existing = '';
    try { existing = fs.readFileSync(MEMORY_FILE, 'utf8'); } catch (e) {
      console.debug('[memory] appendMemory falhou:', e);
    }
    const newEntry = `\n- ${content.replace(/^[-*]\s*/, '')}`;
    const updated = existing + newEntry;
    const truncated = updated.length > MEMORY_CHAR_LIMIT
      ? updated.slice(0, MEMORY_CHAR_LIMIT) + `\n\n> *Memória truncada (limite ${MEMORY_CHAR_LIMIT} chars)*`
      : updated;
    atomicWrite(MEMORY_FILE, truncated);
    return { success: true, output: `Memória salva (${content.length} chars, total ${truncated.length}/${MEMORY_CHAR_LIMIT})` };
  } catch (e: any) {
    return { success: false, output: `Erro ao salvar memória: ${e.message}` };
  }
}

export function saveUserProfile(content: string): { success: boolean; output: string } {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    let existing = '';
    try { existing = fs.readFileSync(USER_FILE, 'utf8'); } catch (e) {
      console.debug('[memory] appendUserContext falhou:', e);
    }
    const newEntry = `\n- ${content.replace(/^[-*]\s*/, '')}`;
    const updated = existing + newEntry;
    const truncated = updated.length > USER_CHAR_LIMIT
      ? updated.slice(0, USER_CHAR_LIMIT) + `\n\n> *Perfil truncado (limite ${USER_CHAR_LIMIT} chars)*`
      : updated;
    atomicWrite(USER_FILE, truncated);
    return { success: true, output: `Perfil salvo (${content.length} chars, total ${truncated.length}/${USER_CHAR_LIMIT})` };
  } catch (e: any) {
    return { success: false, output: `Erro ao salvar perfil: ${e.message}` };
  }
}

export function readMemory(): { success: boolean; output: string } {
  try {
    const mem = readOrInit(MEMORY_FILE, 'MEMÓRIA');
    const usr = readOrInit(USER_FILE, 'PERFIL');
    return { success: true, output: `=== MEMÓRIA DO MANIAC ===\n${mem}\n\n=== PERFIL DO USUÁRIO ===\n${usr}` };
  } catch (e: any) {
    return { success: false, output: `Erro ao ler memória: ${e.message}` };
  }
}
