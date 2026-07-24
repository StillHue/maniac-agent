import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

try {
  const dotenv = require('dotenv') as { config: (opts: { path: string }) => void };
  const candidates = [
    path.join(os.homedir(), '.maniac', '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
} catch {
  /* dotenv optional */
}

const MANIAC_DIR = process.env.MANIAC_DIR || path.join(os.homedir(), '.maniac');
/** ElevenLabs "Sarah" — works with free-tier turbo models via API. */
export const DEFAULT_ELEVEN_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
/** Free tier: library voices need turbo/flash — not eleven_multilingual_v2. */
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';

export function getElevenLabsApiKey(): string {
  return (
    process.env.ELEVENLABS_API_KEY?.trim() ||
    process.env.ELEVEN_API_KEY?.trim() ||
    process.env.XI_API_KEY?.trim() ||
    ''
  );
}

export function voiceAvailable(): boolean {
  return getElevenLabsApiKey().length > 0;
}

/** Strip markdown / tool noise so TTS doesn't read code fences aloud. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
}

export async function synthesizeSpeech(
  text: string,
  opts?: { voiceId?: string; modelId?: string },
): Promise<Buffer> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not set — add it to ~/.maniac/.env');
  }
  const clean = stripForSpeech(text);
  if (!clean) throw new Error('nothing to speak');

  const voiceId = opts?.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVEN_VOICE_ID;
  const modelId = opts?.modelId || process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

  const res = await fetch(`${TTS_URL}/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: clean,
      model_id: modelId,
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`ElevenLabs HTTP ${res.status}${err ? `: ${err.slice(0, 180)}` : ''}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('ElevenLabs returned empty audio');
  return buf;
}

function ensureManiacDir(): void {
  if (!fs.existsSync(MANIAC_DIR)) fs.mkdirSync(MANIAC_DIR, { recursive: true });
}

async function playMp3File(filePath: string): Promise<void> {
  const abs = path.resolve(filePath);
  if (process.platform === 'darwin') {
    await runCmd('afplay', [abs]);
    return;
  }
  if (process.platform === 'linux') {
    for (const [cmd, args] of [
      ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', abs]],
      ['mpg123', ['-q', abs]],
      ['play', ['-q', abs]],
    ] as const) {
      try {
        await runCmd(cmd, [...args]);
        return;
      } catch {
        /* try next */
      }
    }
    throw new Error('no audio player found (ffplay/mpg123/play)');
  }

  // Windows — WPF MediaPlayer (supports mp3, no extra deps)
  const uri = 'file:///' + abs.replace(/\\/g, '/');
  const ps = `
Add-Type -AssemblyName presentationCore
$p = New-Object System.Windows.Media.MediaPlayer
$p.Open([Uri]'${uri.replace(/'/g, "''")}')
$p.Volume = 1
$sw = [Diagnostics.Stopwatch]::StartNew()
do { Start-Sleep -Milliseconds 50 } while (-not $p.NaturalDuration.HasTimeSpan -and $sw.Elapsed.TotalSeconds -lt 8)
$p.Play()
if ($p.NaturalDuration.HasTimeSpan) {
  $total = $p.NaturalDuration.TimeSpan.TotalMilliseconds
  do { Start-Sleep -Milliseconds 150 } while ($p.Position.TotalMilliseconds + 80 -lt $total -and $sw.Elapsed.TotalSeconds -lt ($total/1000 + 30))
} else {
  Start-Sleep -Seconds 4
}
$p.Stop()
$p.Close()
`.trim();
  await runCmd('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
}

function runCmd(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code && code !== 0) reject(new Error(`${command} exited ${code}`));
      else resolve();
    });
  });
}

/** Synthesize + play. Non-throwing wrapper returns error string for UI. */
export async function speakText(
  text: string,
  opts?: { voiceId?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!voiceAvailable()) {
      return { ok: false, error: 'ELEVENLABS_API_KEY missing (~/.maniac/.env)' };
    }
    ensureManiacDir();
    const audio = await synthesizeSpeech(text, opts);
    const out = path.join(MANIAC_DIR, 'tts-last.mp3');
    fs.writeFileSync(out, audio);
    await playMp3File(out);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
