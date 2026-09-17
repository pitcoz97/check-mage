import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { HTTP, type ServerText } from '../serverTexts';

/**
 * Utenti e partite in memoria: porting delle query di `handlers/auth.go`, `handlers/stats.go` e `db/db.go`.
 */

export interface User {
  id: number;
  username: string;
  email: string;
  elo: number;
  createdAt: string;
  passwordHash: Buffer;
  salt: Buffer;
}

export interface GameRow {
  id: number;
  whiteId: number;
  blackId: number;
  pgn: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  timeControl: string;
  playedAt: string;
}

const EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const USERNAME = /^[a-zA-Z0-9_]+$/;

/** `validation/validation.go:11-69`. Le lunghezze sono in byte, come `len()` in Go. */
export function validateRegister(username: string, email: string, password: string): ServerText | null {
  const trimmed = username.trim();
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  if (bytes(trimmed) < 3) return HTTP.usernameTooShort;
  if (bytes(trimmed) > 20) return HTTP.usernameTooLong;
  if (!USERNAME.test(trimmed)) return HTTP.usernameChars;
  if (!EMAIL.test(email)) return HTTP.emailInvalid;
  if (bytes(password) < 8) return HTTP.passwordTooShort;
  if (bytes(password) > 72) return HTTP.passwordTooLong;
  if (!/[A-Z]/.test(password)) return HTTP.passwordUpper;
  if (!/[a-z]/.test(password)) return HTTP.passwordLower;
  if (!/[0-9]/.test(password)) return HTTP.passwordDigit;
  return null;
}

/** `db/db.go:93-119`: FIDE, K=32, arrotondamento indipendente per i due giocatori. */
export function calculateElo(whiteElo: number, blackElo: number, result: string): [number, number] {
  const K = 32;
  const expectedWhite = 1 / (1 + 10 ** ((blackElo - whiteElo) / 400));
  const expectedBlack = 1 - expectedWhite;
  const [scoreWhite, scoreBlack] = result === '1-0' ? [1, 0] : result === '0-1' ? [0, 1] : [0.5, 0.5];
  // math.Round di Go arrotonda lo .5 lontano da zero.
  const round = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
  return [whiteElo + round(K * (scoreWhite - expectedWhite)), blackElo + round(K * (scoreBlack - expectedBlack))];
}

export function createUserStore() {
  const users = new Map<number, User>();
  const games: GameRow[] = [];
  let nextUserId = 1;
  let nextGameId = 1;

  const hash = (password: string, salt: Buffer) => scryptSync(password, salt, 64);

  return {
    /** `INSERT ... RETURNING id`: `null` se username o email esistono già (vincoli UNIQUE). */
    insert(username: string, email: string, password: string): User | null {
      for (const u of users.values()) if (u.username === username || u.email === email) return null;
      const salt = randomBytes(16);
      const user: User = {
        id: nextUserId++,
        username,
        email,
        elo: 1200,
        createdAt: new Date().toISOString(),
        salt,
        passwordHash: hash(password, salt),
      };
      users.set(user.id, user);
      return user;
    },

    findByEmail(email: string): User | undefined {
      return [...users.values()].find((u) => u.email === email);
    },

    findById(id: number): User | undefined {
      return users.get(id);
    },

    checkPassword(user: User, password: string): boolean {
      return timingSafeEqual(hash(password, user.salt), user.passwordHash);
    },

    /** `handlers/stats.go:17-22`. */
    leaderboard(): User[] {
      return [...users.values()].sort((a, b) => b.elo - a.elo).slice(0, 10);
    },

    /** `handlers/stats.go:64-79`: ultime 20, più recenti prima. */
    gamesOf(userId: number): GameRow[] {
      return games.filter((g) => g.whiteId === userId || g.blackId === userId).reverse().slice(0, 20);
    },

    /** `handlers/stats.go:141-148`. */
    statsOf(userId: number): { wins: number; losses: number; draws: number } {
      let wins = 0;
      let losses = 0;
      let draws = 0;
      for (const g of games) {
        if (g.whiteId !== userId && g.blackId !== userId) continue;
        if (g.result === '1/2-1/2') draws++;
        else if ((g.whiteId === userId) === (g.result === '1-0')) wins++;
        else losses++;
      }
      return { wins, losses, draws };
    },

    /** `db/db.go:51-90`: salva la partita e aggiorna gli ELO. */
    saveGame(whiteId: number, blackId: number, pgn: string, result: GameRow['result'], timeControl: string): void {
      games.push({ id: nextGameId++, whiteId, blackId, pgn, result, timeControl, playedAt: new Date().toISOString() });
      const white = users.get(whiteId);
      const black = users.get(blackId);
      if (white === undefined || black === undefined) return;
      [white.elo, black.elo] = calculateElo(white.elo, black.elo, result);
    },
  };
}

export type UserStore = ReturnType<typeof createUserStore>;
