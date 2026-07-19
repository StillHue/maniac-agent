import * as fs from 'fs';
import * as path from 'path';

const TOOLS_FILE = path.join(__dirname, 'custom-tools.json');

export function loadCustomTools() {
  try {
    const data = fs.readFileSync(TOOLS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomTools(tools: any[]) {
  fs.writeFileSync(TOOLS_FILE, JSON.stringify(tools, null, 2));
}