import { randomBytes } from 'node:crypto';

import type { JwtClaims } from './jwt';

/**
 * Porting di `middleware/wsticket.go`: ticket opachi e monouso per aprire il WebSocket senza mettere il JWT
 * nell'URL. Il client li ottiene con `GET /ws/ticket` e si connette con `/ws?ticket=…`.
 */

/** `TicketTTL` (`middleware/wsticket.go:15`). */
export const TICKET_TTL_MS = 30_000;

export function createTicketStore(ttlMs: number = TICKET_TTL_MS, now: () => number = Date.now) {
  const tickets = new Map<string, { claims: JwtClaims; expires: number }>();

  return {
    ttlMs,

    /** `Issue` (`middleware/wsticket.go:42-59`): 32 byte casuali in hex; a ogni emissione ripulisce gli scaduti. */
    issue(claims: JwtClaims): string {
      const ticket = randomBytes(32).toString('hex');
      const t = now();
      for (const [key, entry] of tickets) if (t > entry.expires) tickets.delete(key);
      tickets.set(ticket, { claims, expires: t + ttlMs });
      return ticket;
    },

    /** `Consume` (`middleware/wsticket.go:62-75`): valido una volta sola, anche se era già scaduto. */
    consume(ticket: string): JwtClaims | null {
      const entry = tickets.get(ticket);
      if (entry === undefined) return null;
      tickets.delete(ticket);
      return now() > entry.expires ? null : entry.claims;
    },
  };
}

export type TicketStore = ReturnType<typeof createTicketStore>;
