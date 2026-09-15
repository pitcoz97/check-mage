/**
 * Modelli di dominio interni del client.
 *
 * Il resto del codice conosce solo questi tipi, mai la forma dei payload del server:
 * la traduzione avviene esclusivamente in `src/api/adapter.ts`.
 */

export type Color = 'white' | 'black';

type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

/** Mossa in notazione UCI, es. `e2e4`, `e7e8q`. */
export type UciMove = string;

export type Username = string;
export type UserId = string;
export type RoomId = string;
export type PieceId = string;
export type SpellId = string;
export type CardInstanceId = string;

export const PHASES = ['draw', 'main1', 'move', 'main2', 'end_turn'] as const;
export type Phase = (typeof PHASES)[number];

export const PIECE_KINDS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export const GAME_RESULTS = ['1-0', '0-1', '1/2-1/2'] as const;
export type GameResult = (typeof GAME_RESULTS)[number] | 'unknown';

export const GAME_OVER_REASONS = [
  'checkmate',
  'stalemate',
  'draw',
  'agreement',
  'resign',
  'timeout',
  'abandonment',
  'server_shutdown',
] as const;
export type GameOverReason = (typeof GAME_OVER_REASONS)[number] | 'unknown';

export const BOARD_STATUSES = ['active'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number] | 'unknown';

/** Stato persistente su un pezzo (es. `freeze`, `shield`). Spazio distinto dagli effetti di magia (A18). */
export interface ActiveEffect {
  readonly kind: string;
  /** `null` se il server non indica una durata. */
  readonly remainingTurns: number | null;
}

export interface PieceState {
  readonly pieceId: PieceId;
  readonly square: Square;
  readonly kind: PieceKind;
  readonly color: Color;
  readonly effects: readonly ActiveEffect[];
}

export interface HandCard {
  readonly instanceId: CardInstanceId;
  readonly spellId: SpellId;
  /** `true` se l'id d'istanza è stato generato dal client perché il server non lo fornisce (G2). */
  readonly instanceIdIsLocal: boolean;
}

export interface ManaState {
  readonly current: number;
  readonly max: number;
}

/** Tempi residui in millisecondi. */
export interface Clocks {
  readonly white: number;
  readonly black: number;
}

export interface TimeControl {
  readonly initialMs: number;
  readonly incrementMs: number;
}

/** Effetto dichiarato dal server in `spell_cast`: il client lo anima, non lo ricalcola (G8). */
export interface AppliedEffect {
  readonly kind: string;
  readonly pieceId: PieceId | null;
  readonly square: Square | null;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Stato completo della partita al suo inizio o alla riconnessione (G4, G5).
 * I campi del layer magie sono `null` quando il server non li fornisce.
 */
export interface MatchSnapshot {
  readonly roomId: RoomId;
  readonly players: { readonly white: Username; readonly black: Username };
  readonly fen: string;
  readonly moves: readonly UciMove[];
  readonly clocks: Clocks | null;
  readonly timeControl: TimeControl | null;
  readonly pieces: readonly PieceState[] | null;
  readonly phase: Phase | 'unknown' | null;
  readonly activePlayer: Username | null;
  readonly turnNumber: number | null;
  /** Solo la mano del giocatore locale: la mano avversaria non esiste lato client. */
  readonly hand: readonly HandCard[] | null;
  readonly handSizes: Readonly<Record<Username, number>> | null;
  readonly deckSizes: Readonly<Record<Username, number>> | null;
  readonly mana: Readonly<Record<Username, ManaState>> | null;
}

/** Errore di protocollo normalizzato. Il testo del server non viene conservato: la UI mappa `code`. */
export interface ProtocolErrorInfo {
  readonly code: string | null;
}
