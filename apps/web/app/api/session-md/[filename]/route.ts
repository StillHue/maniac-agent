import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

const SESSION_DIR = 'C:\\Users\\gabdr\\agent-session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const safe = path.resolve(SESSION_DIR, filename);
  if (!safe.startsWith(SESSION_DIR)) {
    return Response.json({ error: 'Invalid path' }, { status: 403 });
  }
  try {
    if (!fs.existsSync(safe)) {
      // List directory if filename looks like a dir listing
      if (filename === '') {
        const files = fs.readdirSync(SESSION_DIR);
        return Response.json({ files });
      }
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    const content = fs.readFileSync(safe, 'utf8');
    return Response.json({ content });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const safe = path.resolve(SESSION_DIR, filename);
  if (!safe.startsWith(SESSION_DIR)) {
    return Response.json({ error: 'Invalid path' }, { status: 403 });
  }
  try {
    const { content } = await req.json() as { content?: string };
    if (content === undefined) {
      return Response.json({ error: 'Missing content' }, { status: 400 });
    }
    fs.writeFileSync(safe, content, 'utf8');
    return Response.json({ status: 'ok' });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const safe = path.resolve(SESSION_DIR, filename);
  if (!safe.startsWith(SESSION_DIR)) {
    return Response.json({ error: 'Invalid path' }, { status: 403 });
  }
  try {
    if (fs.existsSync(safe)) fs.unlinkSync(safe);
    return Response.json({ status: 'ok' });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
