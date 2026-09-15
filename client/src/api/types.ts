/**
 * Modelli REST **interni**. Nessun DTO del server: la forma sul filo vive solo in `adapter.ts`.
 */

import type { UserId, Username } from '../game/model';

export interface UserSummary {
  readonly id: UserId;
  readonly username: Username;
  readonly elo: number;
}

export interface UserStats {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface UserProfile extends UserSummary {
  /** `null` se il server non include le statistiche nella risposta. */
  readonly stats: UserStats | null;
}

export interface AuthSession {
  readonly token: string;
  readonly user: UserSummary;
}

export interface WsTicket {
  readonly ticket: string;
  /** `null` se il server non dichiara la durata. */
  readonly expiresInMs: number | null;
}

export interface HttpErrorInfo {
  readonly status: number;
  /** Codice macchina-leggibile, se presente. Il testo del server non viene conservato. */
  readonly code: string | null;
}
