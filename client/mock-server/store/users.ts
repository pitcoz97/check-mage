import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Politica credenziali assunta (ASSUMPTIONS.md A11). */
export const USERNAME_RULE = { min: 3, max: 20, pattern: /^[A-Za-z0-9_]+$/ };
export const PASSWORD_RULE = { min: 8, max: 72 };

export interface User {
  id: number;
  username: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  passwordHash: Buffer;
  salt: Buffer;
}

export interface GameRecord {
  id: number;
  room_id: string;
  white: string;
  black: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  reason: string;
  ended_at: string;
  whiteId: number;
  blackId: number;
}

export function validateUsername(username: unknown): username is string {
  return (
    typeof username === 'string' &&
    username.length >= USERNAME_RULE.min &&
    username.length <= USERNAME_RULE.max &&
    USERNAME_RULE.pattern.test(username)
  );
}

export function validatePassword(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_RULE.min &&
    Buffer.byteLength(password, 'utf8') <= PASSWORD_RULE.max
  );
}

const K_FACTOR = 32;

/** ELO FIDE standard con K=32 (briefing §3.1). `score` è il punteggio del primo giocatore. */
export function eloUpdate(a: number, b: number, score: 0 | 0.5 | 1): [number, number] {
  const expectedA = 1 / (1 + 10 ** ((b - a) / 400));
  const deltaA = Math.round(K_FACTOR * (score - expectedA));
  return [a + deltaA, b - deltaA];
}

export function createUserStore() {
  const users = new Map<number, User>();
  const games: GameRecord[] = [];
  let nextUserId = 1;
  let nextGameId = 1;

  function hash(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, 64);
  }

  return {
    findByUsername(username: string): User | undefined {
      const wanted = username.toLowerCase();
      return [...users.values()].find((u) => u.username.toLowerCase() === wanted);
    },

    findById(id: number): User | undefined {
      return users.get(id);
    },

    create(username: string, password: string): User {
      const salt = randomBytes(16);
      const user: User = {
        id: nextUserId++,
        username,
        elo: 1200,
        wins: 0,
        losses: 0,
        draws: 0,
        salt,
        passwordHash: hash(password, salt),
      };
      users.set(user.id, user);
      return user;
    },

    checkPassword(user: User, password: string): boolean {
      const candidate = hash(password, user.salt);
      return timingSafeEqual(candidate, user.passwordHash);
    },

    leaderboard(limit = 10): User[] {
      return [...users.values()].sort((a, b) => b.elo - a.elo || a.id - b.id).slice(0, limit);
    },

    gamesOf(userId: number): GameRecord[] {
      return games.filter((g) => g.whiteId === userId || g.blackId === userId);
    },

    /** Registra la partita conclusa e aggiorna ELO e statistiche. */
    recordGame(record: Omit<GameRecord, 'id' | 'ended_at'>): void {
      games.push({ ...record, id: nextGameId++, ended_at: new Date().toISOString() });
      const white = users.get(record.whiteId);
      const black = users.get(record.blackId);
      if (white === undefined || black === undefined) return;
      const score = record.result === '1-0' ? 1 : record.result === '0-1' ? 0 : 0.5;
      [white.elo, black.elo] = eloUpdate(white.elo, black.elo, score);
      if (score === 1) {
        white.wins++;
        black.losses++;
      } else if (score === 0) {
        black.wins++;
        white.losses++;
      } else {
        white.draws++;
        black.draws++;
      }
    },
  };
}

export type UserStore = ReturnType<typeof createUserStore>;

export function publicUser(user: User) {
  return { id: user.id, username: user.username, elo: user.elo };
}

export function userProfile(user: User) {
  return { ...publicUser(user), wins: user.wins, losses: user.losses, draws: user.draws };
}
