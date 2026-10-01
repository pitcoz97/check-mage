/**
 * Modelli REST **interni**. Nessun DTO del server: la forma sul filo vive solo in `adapter.ts`.
 * Riferimenti = chess-server `internal/`, branch `fix/backend-requests`.
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

/** Una voce di `GET /me/collection`: copie possedute di una magia, da 0 al massimo della rarità. */
export interface CollectionCard {
  readonly spellId: string;
  readonly copies: number;
  readonly maxCopies: number;
}

/** `GET /me/collection`: una voce per magia del catalogo, più le copie possedute su quelle possibili. */
export interface CardCollection {
  readonly cards: readonly CollectionCard[];
  readonly owned: number;
  readonly total: number;
}

/** Un mazzo personale (`handlers/decks.go`): `valid` e `active` li decide il server (D1, D3). */
export interface Deck {
  readonly id: string;
  readonly name: string;
  /** Copie per id di magia, solo quelle > 0. */
  readonly cards: ReadonlyMap<string, number>;
  readonly size: number;
  readonly valid: boolean;
  readonly active: boolean;
  readonly updatedAt: string;
}

/** `GET /me/decks`: i mazzi, il loro massimo e la dimensione di un mazzo valido. */
export interface DeckList {
  readonly decks: readonly Deck[];
  readonly maxDecks: number;
  readonly deckSize: number;
}

export interface GameHistoryEntry {
  readonly id: string;
  /** Assenti sui server precedenti alle sfide: si riconosce il lato dal nome. */
  readonly whiteId: UserId | null;
  readonly blackId: UserId | null;
  readonly white: Username;
  readonly black: Username;
  readonly result: GameResult;
  readonly timeControl: string;
  readonly pgn: string;
  readonly playedAt: string;
  /** `false` per le amichevoli (F8); assente = classificata. */
  readonly rated: boolean;
}

/** Stato di un amico (`handlers/friends.go`, F3). */
export const FRIEND_STATUSES = ['online', 'playing', 'offline'] as const;
export type FriendStatus = (typeof FRIEND_STATUSES)[number];

export interface Friend {
  readonly id: UserId;
  readonly username: Username;
  readonly elo: number;
  readonly status: FriendStatus;
}

/**
 * `GET /me/friends` (A1–A3): amici veri, altri giocatori (solo finché sul server tutti sono sfidabili), richieste
 * ricevute e inviate. In ogni lista: online, poi in partita, poi offline (l'ordine è del server).
 */
export interface FriendList {
  readonly friends: readonly Friend[];
  readonly others: readonly Friend[];
  readonly incoming: readonly Friend[];
  readonly outgoing: readonly Friend[];
  /** Online fra amici e altri giocatori. */
  readonly online: number;
  readonly maxFriends: number;
}

/** Relazione con un altro giocatore (ricerca, profilo, fine partita). */
export const RELATIONS = ['none', 'friend', 'incoming', 'outgoing'] as const;
export type Relation = (typeof RELATIONS)[number];

/** Un risultato di `GET /users/search` (A5). */
export interface UserSearchResult {
  readonly id: UserId;
  readonly username: Username;
  readonly elo: number;
  readonly relation: Relation;
}

/** Un giocatore bloccato (`GET /me/blocks`, A8). */
export interface BlockedUser {
  readonly id: UserId;
  readonly username: Username;
}

export interface ChallengePlayer {
  readonly id: UserId;
  readonly username: Username;
  readonly elo: number;
}

/** Una sfida diretta aperta (`game/challenges.go`, F4). */
export interface Challenge {
  readonly id: string;
  readonly from: ChallengePlayer;
  readonly to: ChallengePlayer;
  readonly expiresInSeconds: number;
}

/** Risposta del segnale di presenza `POST /me/presence`: le sfide ricevute ancora aperte. */
export interface PresenceUpdate {
  readonly incoming: readonly Challenge[];
  /** Richieste d'amicizia ricevute in attesa, per il badge (A6). */
  readonly friendRequests: number;
}

/** `GET /ws/ticket` (`handlers/ws.go:23-42`): ticket monouso per aprire il WebSocket. */
export interface WsTicket {
  readonly ticket: string;
  readonly expiresInSeconds: number;
}

/**
 * Requisiti di registrazione da mostrare prima del submit, da `GET /auth/password-policy` o dalla riserva
 * dell'adapter. Le lunghezze della password sono in byte.
 */
export interface CredentialPolicy {
  readonly username: { readonly minLength: number; readonly maxLength: number; readonly pattern: RegExp };
  readonly email: { readonly pattern: RegExp };
  readonly password: {
    readonly minBytes: number;
    readonly maxBytes: number;
    readonly requireUppercase: boolean;
    readonly requireLowercase: boolean;
    readonly requireDigit: boolean;
  };
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
  'ticket_invalid',
  'rate_limited',
  'invalid_id',
  'internal_error',
  'not_found',
  'method_not_allowed',
  'service_unavailable',
  // Mazzi (handlers/decks.go)
  'deck_limit',
  'deck_name_invalid',
  'deck_unknown_spell',
  'deck_too_many_copies',
  'deck_not_owned',
  'deck_not_valid',
  'deck_last',
  'deck_not_found',
  // Sfide (handlers/challenges.go)
  'challenge_self',
  'challenge_player_not_found',
  'challenge_offline',
  'challenge_target_busy',
  'challenge_self_busy',
  'challenge_not_found',
  // Amicizie e blocchi (handlers/friendships.go)
  'friend_self',
  'friend_already',
  'friend_pending',
  'friend_limit',
  'friend_their_limit',
  'friend_pending_limit',
  'friend_request_not_found',
  'friend_not_found',
  'block_self',
  'block_not_found',
  'search_too_short',
  // Codici generati dal client, non dal server:
  /** Server irraggiungibile (fetch fallita, timeout, offline). */
  'network_error',
  /** Risposta 2xx con un corpo che l'adapter non riesce a normalizzare. */
  'invalid_response',
] as const;
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];

export interface HttpErrorInfo {
  readonly status: number;
  /** Codice ricavato dal testo del server. `null` se il testo non è riconosciuto (ASSUMPTIONS C4). */
  readonly code: HttpErrorCode | null;
}
