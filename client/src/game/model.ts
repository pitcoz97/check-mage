/**
 * Modelli di dominio interni del client.
 *
 * Il resto del codice conosce solo questi tipi, mai la forma dei payload del server:
 * la traduzione avviene esclusivamente in `src/api/adapter.ts`.
 * Riferimenti `file.go:riga` = chess-server, `internal/`.
 */

export type Color = 'white' | 'black';
export const COLORS: readonly Color[] = ['white', 'black'];

type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

/** Mossa in notazione UCI, es. `e2e4`, `e7e8q`. */
export type UciMove = string;

export type Username = string;
export type UserId = string;
export type SpellId = string;
/** Id d'istanza generato dal client: il server identifica le carte solo per `spell_id` (ASSUMPTIONS G2). */
export type CardInstanceId = string;

// `phase/phase.go:8-12`
export const PHASES = ['draw', 'main1', 'move', 'main2', 'end_turn'] as const;
export type Phase = (typeof PHASES)[number];

export const PIECE_KINDS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

// `models/response.go:42-44`
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

// `game/room.go:398-408,1194`
export const BOARD_STATUSES = ['active', 'checkmate', 'stalemate', 'draw'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number] | 'unknown';

export type PerColor<T> = Readonly<Record<Color, T>>;

export interface ManaState {
  readonly current: number;
  readonly max: number;
}

/** Tempi residui in millisecondi. */
export type Clocks = PerColor<number>;

/** Stato persistente su un pezzo (`freeze`, `shield`): spazio distinto dagli effetti di magia (A18). */
export interface ActiveEffect {
  readonly kind: string;
  readonly remainingTurns: number;
  readonly sourceSpellId: SpellId | null;
}

/** Effetti attivi sul pezzo che sta in `square` (`effects/tracker.go:242-267`). */
export interface SquareEffects {
  readonly square: Square;
  readonly effects: readonly ActiveEffect[];
}

export interface PlayerRef {
  readonly id: UserId;
  readonly username: Username;
}

/** Identità dei giocatori: arriva solo se il server applica P0-5 (ASSUMPTIONS C1). */
export type MatchPlayers = PerColor<PlayerRef>;

/** Stato pubblico di `game_state` (`game/room.go:1101-1119`). */
export interface PublicGameState {
  readonly fen: string;
  readonly moves: readonly UciMove[];
  /** Tratto scacchistico secondo la FEN: può differire da `activePlayer` in `main2`. */
  readonly turn: Color | 'unknown';
  readonly status: BoardStatus;
  readonly clocks: Clocks;
  readonly phase: Phase | 'unknown';
  readonly activePlayer: Color | 'unknown';
  readonly turnNumber: number;
  readonly mana: PerColor<ManaState>;
  readonly handSizes: PerColor<number>;
  readonly deckSizes: PerColor<number>;
  readonly activeEffects: readonly SquareEffects[];
  /** `true` solo nel `game_state` inviato a chi si riconnette (`game/room.go:924`). */
  readonly reconnected: boolean;
  /** `null` finché il server non comunica l'identità dei giocatori (P0-5). */
  readonly players: MatchPlayers | null;
}

export interface HandCard {
  readonly instanceId: CardInstanceId;
  readonly spellId: SpellId;
}

/** Mano privata di `hand` (`game/room.go:827-842`). */
export interface PrivateHand {
  readonly cards: readonly HandCard[];
  readonly mana: ManaState;
  readonly deckSize: number;
}

/** Effetto dichiarato dal server in `spell_cast` (`game/room.go:583-661`): il client lo anima, non lo ricalcola. */
export type AppliedEffect =
  | { readonly kind: 'noop' }
  | { readonly kind: 'destroy_piece'; readonly target: Square; readonly destroyedPiece: PieceKind | 'unknown' }
  | { readonly kind: 'freeze_piece' | 'shield_piece'; readonly target: Square; readonly remainingTurns: number }
  | { readonly kind: 'move_piece'; readonly from: Square; readonly to: Square }
  | { readonly kind: 'draw_card'; readonly count: number }
  | { readonly kind: 'gain_mana'; readonly amount: number; readonly manaAfter: number }
  /** Effetto sconosciuto o malformato: si mostra neutro, non blocca il resto (§5.1.6). */
  | { readonly kind: 'unknown'; readonly rawKind: string };

/** `effect_expired` (`game/room.go:422,732`). */
export interface ExpiredEffect {
  readonly square: Square;
  readonly kind: string;
  readonly pieceId: string | null;
  readonly reason: 'expired' | 'shield_absorbed' | 'unknown';
}

/** Codici ricavati dai testi d'errore del server (`adapter.ts` §3b). */
export const PROTOCOL_ERROR_CODES = [
  'not_your_turn',
  'wrong_phase',
  'illegal_move',
  'piece_frozen',
  'malformed_message',
  'unknown_message_type',
  'rate_limited',
  'draw_offer_pending',
  'no_draw_offer',
  'own_draw_offer',
  'already_queued',
  'unknown_spell',
  'card_not_in_hand',
  'insufficient_mana',
  'wrong_target_count',
  'no_piece_on_target',
  'target_must_be_enemy',
  'target_must_be_own',
  'king_not_targetable',
  'destination_occupied',
  'exposes_own_king',
  'invalid_square',
  'unsupported_effect',
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

/** Errore di protocollo normalizzato. Il testo del server non viene conservato. */
export interface ProtocolErrorInfo {
  readonly code: ProtocolErrorCode | null;
  readonly square: Square | null;
  readonly needed: number | null;
  readonly available: number | null;
}
