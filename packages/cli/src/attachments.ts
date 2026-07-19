import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Image attachment referenced in the input as [imageN]. */
export interface ImageAttachment {
  placeholder: string;
  path: string;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/**
 * Reads an image from the Windows clipboard (bitmap or copied image file)
 * and saves it to a temp PNG. Returns null when the clipboard has no image.
 */
export function captureClipboardImage(): string | null {
  if (process.platform !== 'win32') return null;
  const dest = path.join(os.tmpdir(), `maniac-paste-${Date.now()}.png`);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
  $img.Save('${dest.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output 'IMG'
  exit 0
}
$files = [System.Windows.Forms.Clipboard]::GetFileDropList()
if ($files -ne $null -and $files.Count -gt 0) {
  Write-Output ('FILE:' + $files[0])
  exit 0
}
Write-Output 'NONE'
`;
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    ).trim();

    if (out === 'IMG' && fs.existsSync(dest)) return dest;
    if (out.startsWith('FILE:')) {
      const file = out.slice(5).trim();
      if (IMAGE_EXT_RE.test(file) && fs.existsSync(file)) return file;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Finds image file paths typed or pasted as text in the message
 * (quoted or bare, e.g. `C:\shots\err.png` or "C:\my shots\err.png").
 * Only returns paths that exist on disk.
 */
export function extractImagePaths(text: string): string[] {
  const found: string[] = [];
  const re = /"([^"]+\.(?:png|jpe?g|gif|webp|bmp))"|'([^']+\.(?:png|jpe?g|gif|webp|bmp))'|((?:[A-Za-z]:)?[\w~.\\/\-]+\.(?:png|jpe?g|gif|webp|bmp))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = (m[1] || m[2] || m[3] || '').trim();
    if (!p) continue;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) found.push(path.resolve(p));
    } catch {}
  }
  return [...new Set(found)];
}

/** Resolves the final image list for a message: [imageN] placeholders + typed paths. */
export function resolveMessageImages(
  text: string,
  attachments: ImageAttachment[],
): string[] {
  const fromPlaceholders = attachments
    .filter((a) => text.includes(a.placeholder))
    .map((a) => a.path);
  const fromText = extractImagePaths(text);
  return [...new Set([...fromPlaceholders, ...fromText])];
}
