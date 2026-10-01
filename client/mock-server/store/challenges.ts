import { randomBytes } from 'node:crypto';

/**
 * Sfide dirette (`game/challenges.go`, F4–F9): solo i dati, la scadenza e lo slot di chi aspetta. Abbinamento e
 * partita stanno nel gateway, che conosce le connessioni.
 */

export interface ChallengePlayer {
  readonly id: number;
  readonly username: string;
  readonly elo: number;
}

/** Codici dell'errore che precede la chiusura 4003. */
export type ChallengeCloseCode = 'challenge_declined' | 'challenge_expired' | 'challenge_unavailable';

/** Chi è collegato alla sfida e aspetta l'altro. */
export interface ChallengeWaiter {
  readonly userId: number;
  challengeClosed(code: ChallengeCloseCode): void;
}

export interface Challenge {
  readonly id: string;
  readonly from: ChallengePlayer;
  readonly to: ChallengePlayer;
  readonly expiresAt: number;
  slot: ChallengeWaiter | null;
}

export interface ChallengeView {
  readonly id: string;
  readonly from: ChallengePlayer;
  readonly to: ChallengePlayer;
  readonly expires_in: number;
}

export function createChallengeStore(ttlMs: number, now: () => number = Date.now) {
  const challenges = new Map<string, Challenge>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const view = (ch: Challenge): ChallengeView => ({
    id: ch.id,
    from: ch.from,
    to: ch.to,
    expires_in: Math.max(0, Math.ceil((ch.expiresAt - now()) / 1000)),
  });

  /** `closeChallengeLocked`: toglie la sfida e avvisa chi aspetta. */
  function close(ch: Challenge, code: ChallengeCloseCode): void {
    clearTimeout(timers.get(ch.id));
    timers.delete(ch.id);
    challenges.delete(ch.id);
    const slot = ch.slot;
    ch.slot = null;
    slot?.challengeClosed(code);
  }

  return {
    view,
    close,

    /** `CreateChallenge`: una sfida precedente di `from` viene sostituita (F5). */
    create(from: ChallengePlayer, to: ChallengePlayer): Challenge {
      for (const ch of [...challenges.values()]) if (ch.from.id === from.id) close(ch, 'challenge_unavailable');
      const ch: Challenge = { id: randomBytes(16).toString('hex'), from, to, expiresAt: now() + ttlMs, slot: null };
      challenges.set(ch.id, ch);
      timers.set(
        ch.id,
        setTimeout(() => {
          if (challenges.get(ch.id) === ch) close(ch, 'challenge_expired');
        }, ttlMs),
      );
      return ch;
    },

    get(id: string): Challenge | undefined {
      return challenges.get(id);
    },

    /** Le sfide ricevute, dalla più vicina alla scadenza. */
    incoming(userId: number): ChallengeView[] {
      return [...challenges.values()]
        .filter((ch) => ch.to.id === userId)
        .sort((a, b) => a.expiresAt - b.expiresAt)
        .map(view);
    },

    /** La sfida è partita: si toglie senza avvisare nessuno. */
    started(ch: Challenge): void {
      clearTimeout(timers.get(ch.id));
      timers.delete(ch.id);
      challenges.delete(ch.id);
      ch.slot = null;
    },

    /** `closeChallengesOfLocked` (F9). */
    closeOf(...userIds: number[]): void {
      for (const ch of [...challenges.values()]) {
        if (userIds.includes(ch.from.id) || userIds.includes(ch.to.id)) close(ch, 'challenge_unavailable');
      }
    },

    /** `CloseChallengesBetween` (A8): uno dei due ha bloccato l'altro. */
    closeBetween(a: number, b: number): void {
      for (const ch of [...challenges.values()]) {
        if ((ch.from.id === a && ch.to.id === b) || (ch.from.id === b && ch.to.id === a)) close(ch, 'challenge_unavailable');
      }
    },

    /** `LeaveChallenge`: se se ne va chi sfida la sfida è annullata, se se ne va lo sfidato resta aperta. */
    leave(waiter: ChallengeWaiter): void {
      for (const ch of [...challenges.values()]) {
        if (ch.slot !== waiter) continue;
        ch.slot = null;
        if (waiter.userId === ch.from.id) close(ch, 'challenge_unavailable');
      }
    },

    dispose(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      challenges.clear();
    },
  };
}

export type ChallengeStore = ReturnType<typeof createChallengeStore>;
