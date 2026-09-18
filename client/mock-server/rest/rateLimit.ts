import type { Bucket } from '../config';

/**
 * Token bucket come `golang.org/x/time/rate.Limiter`: parte pieno (`burst` gettoni), si ricarica a `rate`/s.
 * Una chiave per IP (`middleware/ratelimit.go:101`): tutte le connessioni dallo stesso indirizzo condividono il limite.
 */
export function createRateLimiter(bucket: Bucket, now: () => number = Date.now) {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return {
    /** `true` se la richiesta è ammessa (`Limiter.Allow`). */
    allow(key: string): boolean {
      const t = now();
      const state = buckets.get(key) ?? { tokens: bucket.burst, updatedAt: t };
      state.tokens = Math.min(bucket.burst, state.tokens + ((t - state.updatedAt) / 1000) * bucket.rate);
      state.updatedAt = t;
      const allowed = state.tokens >= 1;
      if (allowed) state.tokens -= 1;
      buckets.set(key, state);
      return allowed;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Node riporta gli IPv4 come IPv6 mappati (`::ffff:1.2.3.4`); `net.IP.Equal` di Go li considera uguali. */
function normalizeIp(address: string): string {
  return address.startsWith('::ffff:') && address.includes('.') ? address.slice('::ffff:'.length) : address;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** `isTrustedProxy` (`middleware/ratelimit.go:127-145`): IP singoli o CIDR (qui solo IPv4). */
export function isTrustedProxy(address: string, trustedProxies: readonly string[]): boolean {
  const ip = normalizeIp(address.trim());
  for (const entry of trustedProxies) {
    if (entry.includes('/')) {
      const [base = '', bits = ''] = entry.split('/');
      const ipValue = ipv4ToInt(ip);
      const baseValue = ipv4ToInt(base);
      const prefix = Number(bits);
      if (ipValue === null || baseValue === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) continue;
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      if (((ipValue & mask) >>> 0) === ((baseValue & mask) >>> 0)) return true;
    } else if (normalizeIp(entry) === ip) {
      return true;
    }
  }
  return false;
}

/**
 * `getIP` (`middleware/ratelimit.go:101-124`): l'IP senza porta. `X-Forwarded-For` (da destra, il primo indirizzo
 * che non è un proxy fidato) e `X-Real-IP` valgono solo se la richiesta arriva da un proxy fidato.
 */
export function clientKey(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
  trustedProxies: readonly string[],
): string {
  const host = normalizeIp(remoteAddress ?? 'unknown');
  if (!isTrustedProxy(host, trustedProxies)) return host;

  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded !== '') {
    const parts = forwarded.split(',');
    for (let i = parts.length - 1; i >= 0; i--) {
      const ip = (parts[i] ?? '').trim();
      if (ip !== '' && !isTrustedProxy(ip, trustedProxies)) return ip;
    }
  }
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim() !== '') return realIp.trim();
  return host;
}
