/**
 * Modelli REST **interni**. Nessun DTO del server: la forma sul filo vive solo in `adapter.ts`.
 * Riferimenti = chess-server `internal/`.
 */

import type { GameResult, UserId, Username } from '../game/model';

/** Utente autenticato (`handlers/auth.go:149-157`, `272-296`). */
export interface UserAccount {
  readonly id: UserId;
  readonly username: Username;
  readonly email: string;
  readonly elo: number;
  readonly createdAt: string | null;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface AuthSession {
  readonly tokens: TokenPair;
  readonly user: UserAccount;
}

export interface Registration {
  readonly userId: UserId;
}

/** `GET /users/{id}` (`handlers/stats.go:111-161`). */
export interface PublicProfile {
  readonly user: {
    readonly id: UserId;
    readonly username: Username;
    readonly elo: number;
    readonly createdAt: string | null;
  };
  readonly stats: {
    readonly wins: number;
    readonly losses: number;
    readonly draws: number;
    readonly total: number;
  };
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly id: UserId;
  readonly username: Username;
  readonly elo: number;
}

export interface GameHistoryEntry {
  readonly id: string;
  readonly white: Username;
  readonly black: Username;
  readonly result: GameResult;
  readonly timeControl: string;
  readonly pgn: string;
  readonly playedAt: string;
}

export interface ServerStatus {
  readonly healthy: boolean;
  readonly version: string | null;
}

export const HTTP_ERROR_CODES = [
  'invalid_request',
  'missing_fields',
  'username_too_short',
  'username_too_long',
  'username_invalid_chars',
  'email_invalid',
  'password_too_short',
  'password_too_long',
  'password_needs_uppercase',
  'password_needs_lowercase',
  'password_needs_digit',
  'username_or_email_taken',
  'invalid_credentials',
  'refresh_token_invalid',
  'token_invalid',
  'user_not_found',
  'token_missing',
  'token_invalid_or_expired',
  'rate_limited',
  'invalid_id',
  'internal_error',
  'not_found',
  'service_unavailable',
] as const;
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];

export interface HttpErrorInfo {
  readonly status: number;
  /** Codice ricavato dal testo del server. `null` se il testo non è riconosciuto (ASSUMPTIONS C4). */
  readonly code: HttpErrorCode | null;
}
