import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * JWT HS256 con le stesse claims di chess-server (`handlers/auth.go:162-184`).
 * Il secret è casuale a ogni avvio del mock: nessun segreto nel repo.
 */

export interface JwtClaims {
  user_id: number;
  username?: string;
  type: 'access' | 'refresh' | 'unknown';
  exp: number;
}

export type AccessClaims = JwtClaims & { username: string };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function createJwtService(
  ttl: { accessSeconds: number; refreshSeconds: number },
  now: () => number = Date.now,
) {
  const secret = randomBytes(32);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const sign = (data: string) => createHmac('sha256', secret).update(data).digest('base64url');
  const issue = (claims: JwtClaims) => {
    const body = `${header}.${base64url(JSON.stringify(claims))}`;
    return `${body}.${sign(body)}`;
  };
  const expiry = (seconds: number) => Math.floor(now() / 1000) + seconds;

  /** Firma HS256 + scadenza, come `jwt.Parse`. Il tipo lo controllano i chiamanti (`verifyAccess`, `/auth/refresh`). */
  function verify(token: string): JwtClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, payload, signature] = parts as [string, string, string];
    const expected = Buffer.from(sign(`${head}.${payload}`));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<JwtClaims>;
      if (typeof claims.user_id !== 'number' || typeof claims.exp !== 'number') return null;
      if (claims.exp * 1000 <= now()) return null;
      return {
        user_id: claims.user_id,
        type: claims.type === 'refresh' || claims.type === 'access' ? claims.type : 'unknown',
        exp: claims.exp,
        ...(typeof claims.username === 'string' ? { username: claims.username } : {}),
      };
    } catch {
      return null;
    }
  }

  return {
    issueAccess(userId: number, username: string): string {
      return issue({ user_id: userId, username, type: 'access', exp: expiry(ttl.accessSeconds) });
    },

    issueRefresh(userId: number): string {
      return issue({ user_id: userId, type: 'refresh', exp: expiry(ttl.refreshSeconds) });
    },

    verify,

    /**
     * `ParseAccessToken` (`middleware/auth.go:56-75`): token valido con `type == "access"` e i claim `user_id` e
     * `username`. Un refresh token non apre le rotte protette.
     */
    verifyAccess(token: string): AccessClaims | null {
      const claims = verify(token);
      if (claims === null || claims.type !== 'access' || claims.username === undefined) return null;
      return { ...claims, username: claims.username };
    },
  };
}

export type JwtService = ReturnType<typeof createJwtService>;
