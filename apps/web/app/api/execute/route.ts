import { NextRequest } from 'next/server';
import { executeToolCall, TOOL_CATALOG } from '@maniac/engine';

export async function GET() {
  const catalog = TOOL_CATALOG.map(t => ({
    name: t.name,
    description: t.description,
    danger: t.danger || false,
    params: t.params || '',
  }));
  return Response.json({ tools: catalog });
}

export async function POST(req: NextRequest) {
  try {
    const { type, command, cwd } = await req.json() as {
      type: string;
      command?: string;
      cwd?: string;
    };

    if (!type) {
      return Response.json({ success: false, output: 'type is required' }, { status: 400 });
    }

    const result = await executeToolCall(type, command || '', cwd || process.cwd());
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ success: false, output: e.message }, { status: 500 });
  }
}
