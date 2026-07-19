import { assertSafeUrl } from './ssrf';

export interface ToolOutput {
  success: boolean;
  output: string;
}

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;
const ENV_REF = /^\$\{ENV:([A-Z0-9_]+)\}$/;
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 500_000;

function resolveSecretRef(value: string): { value: string; redacted: string } {
  const m = value.match(ENV_REF);
  if (!m) return { value, redacted: value };
  const name = m[1];
  // Only dedicated HTTP secret env vars — never raw provider/API tokens
  if (!name.startsWith('MANIAC_HTTP_SECRET_')) {
    throw new Error(
      `Secret ref \${ENV:${name}} not allowed. Copy the value into MANIAC_HTTP_SECRET_<NAME> and reference that.`,
    );
  }
  const resolved = process.env[name];
  if (!resolved) throw new Error(`Environment variable ${name} is not set`);
  return { value: resolved, redacted: `\${ENV:${name}}` };
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export interface HttpRequestArgs {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | object;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function toolHttpRequest(rawArgs: string): Promise<ToolOutput> {
  let parsed: HttpRequestArgs;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return {
      success: false,
      output:
        'formato JSON: {"method":"GET|POST|...","url":"https://...","headers":{},"body":"...","timeoutMs":30000,"maxBytes":500000}',
    };
  }

  if (!parsed.url || typeof parsed.url !== 'string') {
    return { success: false, output: 'url is required' };
  }

  const method = (parsed.method || 'GET').toUpperCase();
  const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
  if (!allowed.has(method)) {
    return { success: false, output: `Unsupported method: ${method}` };
  }

  const timeoutMs = Math.min(Math.max(parsed.timeoutMs || DEFAULT_TIMEOUT_MS, 1000), 120000);
  const maxBytes = Math.min(Math.max(parsed.maxBytes || DEFAULT_MAX_BYTES, 1024), 2_000_000);

  const headersIn = parsed.headers || {};
  const headers: Record<string, string> = {};
  const headersForLog: Record<string, string> = {};
  try {
    for (const [k, v] of Object.entries(headersIn)) {
      const { value, redacted } = resolveSecretRef(String(v));
      headers[k] = value;
      headersForLog[k] = SENSITIVE_HEADER.test(k) ? '[REDACTED]' : redacted;
    }
  } catch (e: any) {
    return { success: false, output: e.message };
  }

  let body: string | undefined;
  if (parsed.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = typeof parsed.body === 'string' ? parsed.body : JSON.stringify(parsed.body);
    if (!headers['Content-Type'] && !headers['content-type'] && typeof parsed.body !== 'string') {
      headers['Content-Type'] = 'application/json';
    }
  }

  let currentUrl = parsed.url;
  let redirects = 0;

  try {
    while (true) {
      await assertSafeUrl(currentUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(currentUrl, {
          method,
          headers,
          body: redirects === 0 ? body : undefined,
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (!loc) return { success: false, output: `Redirect ${res.status} without Location` };
        redirects++;
        if (redirects > MAX_REDIRECTS) {
          return { success: false, output: `Too many redirects (>${MAX_REDIRECTS})` };
        }
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      const rawHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        rawHeaders[k] = v;
      });

      const buf = Buffer.from(await res.arrayBuffer());
      const truncated = buf.length > maxBytes;
      const text = buf.slice(0, maxBytes).toString('utf8');

      const output = JSON.stringify(
        {
          status: res.status,
          url: currentUrl,
          headers: redactHeaders(rawHeaders),
          requestHeaders: headersForLog,
          body: text,
          truncated,
          bytes: buf.length,
        },
        null,
        2,
      );

      return { success: res.ok, output };
    }
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? `Request timed out after ${timeoutMs}ms` : e.message;
    return { success: false, output: msg };
  }
}
