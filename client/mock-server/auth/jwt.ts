import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * JWT HS256 minimale. Il secret è casuale a ogni avvio del processo: nessun segreto nel repo, e i token
 * di una sessione precedente del mock risultano non validi (utile per provare il 401 → logout).
 */

export interface JwtClaims {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function createJwtService(ttlSeconds: number, now: () => number = Date.now) {
  const secret = randomBytes(32);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

  function sign(data: string): string {
    return createHmac('sha256', secret).update(data).digest('base64url');
  }

  return {
    issue(userId: string, username: string): string {
      const iat = Math.floor(now() / 1000);
      const claims: JwtClaims = { sub: userId, username, iat, exp: iat + ttlSeconds };
      const body = `${header}.${base64url(JSON.stringify(claims))}`;
      return `${body}.${sign(body)}`;
    },

    /** Restituisce le claims se il token è integro e non scaduto, altrimenti `null`. */
    verify(token: string): JwtClaims | null {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [head, payload, signature] = parts as [string, string, string];
      const expected = Buffer.from(sign(`${head}.${payload}`));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<JwtClaims>;
        if (typeof claims.sub !== 'string' || typeof claims.username !== 'string' || typeof claims.exp !== 'number') {
          return null;
        }
        if (claims.exp * 1000 <= now()) return null;
        return { sub: claims.sub, username: claims.username, iat: claims.iat ?? 0, exp: claims.exp };
      } catch {
        return null;
      }
    },
  };
}

export type JwtService = ReturnType<typeof createJwtService>;
