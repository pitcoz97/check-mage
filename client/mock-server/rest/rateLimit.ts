import type { Bucket } from '../config';

/**
 * Token bucket come `golang.org/x/time/rate.Limiter`: parte pieno (`burst` gettoni), si ricarica a `rate`/s.
 * La chiave è quella usata dal server: `middleware/ratelimit.go:96-105` restituisce `r.RemoteAddr`, cioè
 * `ip:porta` (BACKEND-REQUESTS B15, replicato).
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

/** `getIP` di `middleware/ratelimit.go:96-105`: header di proxy, altrimenti `RemoteAddr` con la porta. */
export function clientKey(headers: Record<string, string | string[] | undefined>, remoteAddress?: string, remotePort?: number): string {
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded !== '') return forwarded;
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp !== '') return realIp;
  return `${remoteAddress ?? 'unknown'}:${remotePort ?? 0}`;
}
