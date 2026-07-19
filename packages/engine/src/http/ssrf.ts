import * as dns from 'dns/promises';
import * as net from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return -1;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n < 0) return true;
  // JS bitwise is signed Int32 — force unsigned comparisons
  const and = (mask: number) => (n & mask) >>> 0;
  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10
  if (and(0xff000000) === 0x00000000) return true;
  if (and(0xff000000) === 0x0a000000) return true;
  if (and(0xff000000) === 0x7f000000) return true;
  if (and(0xffff0000) === 0xa9fe0000) return true;
  if (and(0xfff00000) === 0xac100000) return true;
  if (and(0xffff0000) === 0xc0a80000) return true;
  if (and(0xffc00000) === 0x64400000) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (normalized.startsWith('fe80')) return true; // link-local
  // IPv4-mapped dotted: ::ffff:127.0.0.1
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPrivateIpv4(dotted[1]);
  // IPv4-mapped hex: ::ffff:7f00:1 or ::ffff:a9fe:a9fe
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return true;
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked protocol: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error(`Blocked hostname: ${host}`);
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`Blocked IP address: ${host}`);
    return url;
  }
  let addresses: string[] = [];
  try {
    const result = await dns.lookup(host, { all: true, verbatim: true });
    addresses = result.map((r) => r.address);
  } catch (e: any) {
    throw new Error(`DNS lookup failed for ${host}: ${e.message}`);
  }
  if (addresses.length === 0) throw new Error(`No DNS records for ${host}`);
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new Error(`Blocked: ${host} resolves to private/link-local address ${addr}`);
    }
  }
  return url;
}
