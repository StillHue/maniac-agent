import * as https from 'https';

const TELEGRAM_API = 'https://api.telegram.org';

export function getTelegramToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN nao configurado');
  return token;
}

export function tgApiCall(method: string, body: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    let token: string;
    try {
      token = getTelegramToken();
    } catch (e) {
      return reject(e);
    }
    const b = JSON.stringify(body);
    const u = new URL(`${TELEGRAM_API}/bot${token}/${method}`);
    const opts = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) },
    };
    const r = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c: string | Buffer) => (d += c.toString()));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve({ ok: false, description: d.slice(0, 200) });
        }
      });
    });
    r.on('error', reject);
    r.write(b);
    r.end();
  });
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  return tgApiCall('sendMessage', {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: 'Markdown',
    ...extra,
  });
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  return tgApiCall('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4000),
    parse_mode: 'Markdown',
    ...extra,
  });
}

export async function answerCallbackQuery(id: string, text?: string): Promise<any> {
  return tgApiCall('answerCallbackQuery', { callback_query_id: id, text });
}

export async function getUpdates(offset?: number, timeout = 25): Promise<any> {
  const body: Record<string, unknown> = {
    timeout,
    allowed_updates: ['message', 'callback_query'],
  };
  if (offset !== undefined) body.offset = offset;
  return tgApiCall('getUpdates', body);
}
