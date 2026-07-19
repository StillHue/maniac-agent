import { NextRequest } from 'next/server';
import { runEngine } from '@maniac/engine';
import { ChatMessage, EngineMode } from '@maniac/types';

export async function POST(req: NextRequest) {
  const { message, mode = 'chat', history = [], repoPath } = await req.json() as {
    message: string;
    mode?: EngineMode;
    history?: ChatMessage[];
    repoPath?: string;
  };

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      try {
        await runEngine({
          message,
          mode: mode || 'chat',
          history,
          repoPath,
          onEvent: (event) => {
            switch (event.type) {
              case 'token':
                sendEvent('token', JSON.stringify({ content: event.content }));
                break;
              case 'reasoning':
                sendEvent('reasoning', JSON.stringify({ content: event.content }));
                break;
              case 'tool_start':
                sendEvent('tool_start', JSON.stringify({ tool: event.tool, args: event.args }));
                break;
              case 'tool_result':
                sendEvent('tool_result', JSON.stringify({
                  tool: event.tool,
                  success: event.success,
                  output: event.output,
                }));
                break;
              case 'mode':
                sendEvent('mode', JSON.stringify({ mode: event.mode }));
                break;
              case 'error':
                sendEvent('error', JSON.stringify({ message: event.message }));
                break;
              case 'done':
                sendEvent('done', JSON.stringify({}));
                break;
            }
          },
        });
      } catch (e: any) {
        sendEvent('error', JSON.stringify({ message: e.message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
