import * as fs from 'fs';
import * as path from 'path';

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  relatedSkills?: string[];
  prerequisites?: { commands?: string[]; envVars?: string[] };
  category?: string;
}

export interface Skill {
  meta: SkillMeta;
  body: string;
  filePath: string;
  category: string;
}

function parseYamlFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  const meta: Record<string, any> = {};
  let body = raw;

  if (raw.startsWith('---')) {
    const end = raw.indexOf('---', 3);
    if (end !== -1) {
      const front = raw.slice(3, end).trim();
      body = raw.slice(end + 3).trim();
      for (const line of front.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let val: any = line.slice(colonIdx + 1).trim();
        if (key === 'metadata') continue;
        if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
          val = val.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
        }
        if (typeof val === 'string') {
          if (val === 'true') val = true;
          else if (val === 'false') val = false;
          else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
          else if (/^\d+$/.test(val)) val = parseInt(val, 10);
          else val = val.replace(/^["']|["']$/g, '');
        }
        meta[key] = val;
      }
    }
  }

  return { meta, body };
}

function discoverSkills(): Skill[] {
  const skills: Skill[] = [];
  if (!fs.existsSync(SKILLS_DIR)) return skills;

  const categories = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const cat of categories) {
    if (!cat.isDirectory()) continue;
    const catPath = path.join(SKILLS_DIR, cat.name);
    const skillDirs = fs.readdirSync(catPath, { withFileTypes: true });
    for (const skillDir of skillDirs) {
      if (!skillDir.isDirectory()) continue;
      const skillMd = path.join(catPath, skillDir.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      try {
        const raw = fs.readFileSync(skillMd, 'utf8');
        const { meta, body } = parseYamlFrontmatter(raw);
        skills.push({
          meta: {
            name: meta.name || skillDir.name,
            description: meta.description || '',
            version: meta.version,
            author: meta.author,
            tags: meta.tags || meta.metadata?.hermes?.tags,
            relatedSkills: meta.related_skills || meta.metadata?.hermes?.related_skills,
            prerequisites: meta.prerequisites,
            category: meta.metadata?.hermes?.category || cat.name,
          },
          body,
          filePath: skillMd,
          category: cat.name,
        });
      } catch {}
    }
  }

  return skills;
}

export function listSkills(): { success: boolean; output: string } {
  try {
    const skills = discoverSkills();
    if (skills.length === 0) return { success: true, output: 'Nenhuma skill encontrada.' };
    const lines = skills.map(s => {
      const tags = s.meta.tags?.length ? ` [${s.meta.tags.slice(0, 3).join(', ')}]` : '';
      return `  ${s.meta.name} — ${s.meta.description}${tags}`;
    });
    return { success: true, output: `Skills disponíveis (${skills.length}):\n${lines.join('\n')}` };
  } catch (e: any) {
    return { success: false, output: `Erro ao listar skills: ${e.message}` };
  }
}

export function viewSkill(name: string): { success: boolean; output: string } {
  try {
    const skills = discoverSkills();
    const skill = skills.find(s => s.meta.name === name);
    if (!skill) return { success: false, output: `Skill "${name}" não encontrada.` };
    const tags = skill.meta.tags?.length ? `\nTags: ${skill.meta.tags.join(', ')}` : '';
    const related = skill.meta.relatedSkills?.length ? `\nRelacionadas: ${skill.meta.relatedSkills.join(', ')}` : '';
    const prereqs = skill.meta.prerequisites
      ? `\nPré-requisitos: ${JSON.stringify(skill.meta.prerequisites)}`
      : '';
    const header = `# ${skill.meta.name} (v${skill.meta.version || '1.0.0'})\n${skill.meta.description}${tags}${related}${prereqs}\n\n`;
    const bodyPreview = skill.body.slice(0, 2000);
    return { success: true, output: header + bodyPreview + (skill.body.length > 2000 ? '\n\n... (truncado)' : '') };
  } catch (e: any) {
    return { success: false, output: `Erro ao ler skill: ${e.message}` };
  }
}

export function createSkill(name: string, description: string, body: string): { success: boolean; output: string } {
  try {
    if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const catMap: Record<string, string> = {
      debug: 'software-development',
      test: 'software-development',
      code: 'software-development',
      refactor: 'software-development',
      plan: 'software-development',
      research: 'research',
      data: 'data-science',
      creative: 'creative',
      note: 'note-taking',
      email: 'email',
      git: 'github',
    };
    const prefix = name.split('-')[0] || 'general';
    const category = catMap[prefix] || 'general';

    const catPath = path.join(SKILLS_DIR, category);
    if (!fs.existsSync(catPath)) fs.mkdirSync(catPath, { recursive: true });

    const skillDir = path.join(catPath, name);
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: "${description.replace(/"/g, '\\"')}"`,
      'version: 1.0.0',
      'author: Maniac',
      'license: MIT',
      `platforms: [windows]`,
      'metadata:',
      '  hermes:',
      `    tags: [${name.split('-').join(', ')}]`,
      '---',
    ].join('\n');

    const md = `${frontmatter}\n\n${body}\n`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), md, 'utf8');
    return { success: true, output: `Skill "${name}" criada em ${category}/${name}/SKILL.md` };
  } catch (e: any) {
    return { success: false, output: `Erro ao criar skill: ${e.message}` };
  }
}

export function buildSkillsBlock(): string {
  const skills = discoverSkills();
  if (skills.length === 0) return '';
  const names = skills.map(s => `  - ${s.meta.name}: ${s.meta.description}`).join('\n');
  return `\n---\n## Skills Disponíveis\n\n${names}\n\nUse [TOOL:skill_view] nome [/TOOL] para ver detalhes.\n---\n`;
}
