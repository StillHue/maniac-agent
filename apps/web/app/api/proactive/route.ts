import { NextRequest, NextResponse } from 'next/server';
import { getUndeliveredMessages, markDelivered } from '@maniac/engine';

export async function GET() {
  const messages = getUndeliveredMessages();
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.ids && Array.isArray(body.ids)) {
    markDelivered(body.ids);
  }
  return NextResponse.json({ ok: true });
}
