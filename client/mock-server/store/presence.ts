/**
 * Presenza (`internal/presence/presence.go`, F2): è online chi ha mandato un segnale negli ultimi `windowMs`, con
 * `POST /me/presence` o aprendo il WebSocket. Solo memoria, come sul server.
 */
export function createPresenceStore(windowMs: number, now: () => number = Date.now) {
  const seen = new Map<number, number>();
  const fresh = (at: number) => now() - at <= windowMs;

  return {
    touch(userId: number): void {
      seen.set(userId, now());
    },
    online(userId: number): boolean {
      const at = seen.get(userId);
      return at !== undefined && fresh(at);
    },
    onlineIds(): number[] {
      return [...seen].filter(([, at]) => fresh(at)).map(([id]) => id);
    },
  };
}

export type PresenceStore = ReturnType<typeof createPresenceStore>;
