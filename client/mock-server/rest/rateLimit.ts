/**
 * Token bucket per IP e per classe di endpoint. Capacità = rate: al massimo `rate` richieste
 * in rapida successione, poi una ogni 1/rate secondi.
 */
export function createRateLimiter(ratePerSecond: number, now: () => number = Date.now) {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return {
    /** `true` se la richiesta è ammessa. */
    take(key: string): boolean {
      const t = now();
      const bucket = buckets.get(key) ?? { tokens: ratePerSecond, updatedAt: t };
      bucket.tokens = Math.min(ratePerSecond, bucket.tokens + ((t - bucket.updatedAt) / 1000) * ratePerSecond);
      bucket.updatedAt = t;
      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;
      buckets.set(key, bucket);
      return allowed;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
