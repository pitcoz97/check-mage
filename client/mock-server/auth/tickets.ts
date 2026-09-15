import { randomBytes } from 'node:crypto';

/** Ticket WebSocket opachi, monouso, a vita breve, tenuti in memoria (P0-1). */
export function createTicketStore(ttlSeconds: number, now: () => number = Date.now) {
  const tickets = new Map<string, { userId: string; expiresAt: number }>();

  return {
    ttlSeconds,

    issue(userId: string): string {
      const ticket = randomBytes(24).toString('base64url');
      tickets.set(ticket, { userId, expiresAt: now() + ttlSeconds * 1000 });
      return ticket;
    },

    /** Consuma il ticket: valido una sola volta. Restituisce l'utente o `null`. */
    consume(ticket: string): string | null {
      const entry = tickets.get(ticket);
      tickets.delete(ticket);
      if (entry === undefined || entry.expiresAt <= now()) return null;
      return entry.userId;
    },
  };
}

export type TicketStore = ReturnType<typeof createTicketStore>;
