/**
 * Modelli di dominio interni del client.
 *
 * Il resto del codice conosce solo questi tipi, mai la forma dei payload del server:
 * la traduzione avviene esclusivamente in `src/api/adapter.ts`.
 * Riferimenti `file.go:riga` = chess-server, `internal/`, branch `fix/backend-requests`.
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

// `game/room.go:533-537,1078,1305,1311,1401,1480`
export const GAME_OVER_REASONS = [
  'checkmate',
  'stalemate',
  'draw',
  'agreement',
  'resign',
  'timeout',
  'abandonment',
] as const;
export type GameOverReason = (typeof GAME_OVER_REASONS)[number] | 'unknown';

// `game/room.go:25-33`: ogni valore diverso da `active` è terminale.
export const BOARD_STATUSES = ['active', 'checkmate', 'stalemate', 'draw', 'resigned', 'timeout', 'abandoned'] as const;
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
  /** Turni residui; `PERMANENT_TURNS` = non scade (oggi solo le rune, ASSUMPTIONS S9). */
  readonly remainingTurns: number;
  readonly sourceSpellId: SpellId | null;
  /** Solo per le rune: chi l'ha piazzata. */
  readonly owner?: Color;
  /** Solo per le rune: la propria runa è ancora nascosta all'avversario (ASSUMPTIONS S10). */
  readonly hidden?: boolean;
  /** Solo per le rune: cosa fa quando scatta (`freeze_piece`, `return_to_origin`, `destroy_piece`). */
  readonly onEnter?: string;
}

/** `remaining_turns` di uno stato che non scade (`effects.Permanent`). */
export const PERMANENT_TURNS = -1;

/**
 * Stati attivi su una casa: quelli del pezzo che ci sta (`active_effects`, `effects/tracker.go`) oppure quelli della
 * casa stessa (`square_effects`: muri, santuari, `effects/squares.go`). La forma è la stessa.
 */
export interface SquareEffects {
  readonly square: Square;
  readonly effects: readonly ActiveEffect[];
}

export interface PlayerRef {
  readonly id: UserId;
  readonly username: Username;
}

/** Identità dei giocatori (`game/room.go:1365-1366`): il colore del giocatore si ricava confrontando gli id con `/me`. */
export type MatchPlayers = PerColor<PlayerRef>;

/** `game_state.time_control` (`game/room.go:1367-1370`). */
export interface TimeControl {
  readonly baseMs: number;
  readonly incrementMs: number;
}

/**
 * Voce di `board.moves`. `absorbed` è la mossa consumata da uno scudo (`"0000"` sul filo, `game/room.go:37,488`):
 * nessun pezzo si è mosso, ma il tratto è passato.
 */
export type PlayedMove = { readonly kind: 'move'; readonly uci: UciMove } | { readonly kind: 'absorbed' };

/** Stato pubblico di `game_state` (`game/room.go:1360-1386`). */
export interface PublicGameState {
  readonly fen: string;
  readonly moves: readonly PlayedMove[];
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
  /** Stati delle case (muri, santuari): restano sulla casa, qualunque pezzo ci sia (ASSUMPTIONS §7 M25–M31). */
  readonly squareStates: readonly SquareEffects[];
  /** Pezzi persi da ciascun giocatore, in ordine (cimitero pubblico, ASSUMPTIONS §7 M19). */
  readonly graveyards: PerColor<readonly PieceKind[]>;
  /** `true` solo nel `game_state` inviato a chi si riconnette (`game/room.go:1136`). */
  readonly reconnected: boolean;
  /** `null` solo se il server non la manda (difesa, ASSUMPTIONS C1): il client non deduce mai il colore. */
  readonly players: MatchPlayers | null;
  readonly timeControl: TimeControl | null;
}

export interface HandCard {
  readonly instanceId: CardInstanceId;
  readonly spellId: SpellId;
}

/** Mano privata di `hand` (`game/room.go:1004-1019`). */
export interface PrivateHand {
  readonly cards: readonly HandCard[];
  readonly mana: ManaState;
  readonly deckSize: number;
}

/** Effetto dichiarato dal server in `spell_cast` (`game/room.go:740-853`): il client lo anima, non lo ricalcola. */
export type AppliedEffect =
  | { readonly kind: 'noop' }
  | { readonly kind: 'destroy_piece'; readonly target: Square; readonly destroyedPiece: PieceKind | 'unknown' }
  | { readonly kind: 'freeze_piece' | 'shield_piece'; readonly target: Square; readonly remainingTurns: number }
  | { readonly kind: 'move_piece'; readonly from: Square; readonly to: Square }
  | { readonly kind: 'draw_card'; readonly count: number }
  | { readonly kind: 'gain_mana'; readonly amount: number; readonly manaAfter: number }
  | {
      readonly kind: 'summon_pawn' | 'transform_piece' | 'promote_piece' | 'revive_piece';
      readonly target: Square;
      readonly piece: PieceKind | 'unknown';
    }
  /** Effetti di massa: uno stato su ogni casa (`freeze_all`, `shield_area`). */
  | { readonly kind: 'freeze_all' | 'shield_area'; readonly targets: readonly Square[]; readonly remainingTurns: number }
  | { readonly kind: 'swap_pieces'; readonly targets: readonly Square[] }
  | { readonly kind: 'restore_castling_rights' }
  /** Uno stato su una casa: `wall` per `create_wall`, il parametro `effect` per `create_square_effect`. */
  | {
      readonly kind: 'create_wall' | 'create_square_effect';
      readonly target: Square;
      readonly state: string;
      readonly remainingTurns: number;
    }
  /** Rune (Step 4): piazzate (solo per chi le lancia), rivelate, detonate. */
  | { readonly kind: 'place_rune'; readonly targets: readonly Square[]; readonly onEnter: string }
  | { readonly kind: 'reveal_runes'; readonly side: Color }
  | {
      readonly kind: 'detonate_runes';
      readonly runes: readonly Square[];
      readonly targets: readonly Square[];
      readonly remainingTurns: number;
    }
  /** L'unico effetto di una magia nascosta vista dall'avversario (ASSUMPTIONS M42). */
  | { readonly kind: 'hidden_effect' }
  /** Effetto sconosciuto o malformato: si mostra neutro, non blocca il resto (§5.1.6). */
  | { readonly kind: 'unknown'; readonly rawKind: string };

/** Cosa ha fatto una runa scattata (`rune_triggered.result`, `game/room.go` triggerRune). */
export type RuneResult =
  | { readonly kind: 'freeze_piece'; readonly target: Square; readonly remainingTurns: number }
  | { readonly kind: 'return_to_origin'; readonly from: Square; readonly to: Square }
  | { readonly kind: 'destroy_piece'; readonly target: Square; readonly destroyedPiece: PieceKind | 'unknown' }
  | { readonly kind: 'unknown'; readonly rawKind: string };

/** `effect_expired` (`game/room.go:548-555,902-916`). Per lo scudo sull'en passant `square` è il pedone catturato. */
export interface ExpiredEffect {
  readonly square: Square;
  readonly kind: string;
  readonly pieceId: string | null;
  readonly reason: 'expired' | 'shield_absorbed' | 'unknown';
}

/** Codici di `error.code` (`gameerr/gameerr.go:17-49`). Un codice sconosciuto diventa `null` (errore generico). */
export const PROTOCOL_ERROR_CODES = [
  'invalid_payload',
  'unknown_message_type',
  'rate_limited',
  'game_over',
  'replaced_by_new_connection',
  'not_your_turn',
  'wrong_phase',
  'illegal_move',
  'piece_frozen',
  'move_blocked',
  'unknown_spell',
  'card_not_in_hand',
  'insufficient_mana',
  'invalid_target_count',
  'invalid_target',
  'illegal_position',
  'limit_reached',
  'no_effect',
  'invalid_choice',
  'draw_offer_pending',
  'no_draw_offer',
  'own_draw_offer',
  'internal_error',
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

/**
 * Errore di protocollo normalizzato: il codice e i `details` utili alla UI (`gameerr/gameerr.go`).
 * Il testo del server non viene conservato; `move`, `spell_id` e `type` il client li conosce già.
 */
export interface ProtocolErrorInfo {
  readonly code: ProtocolErrorCode | null;
  /** `piece_frozen`. */
  readonly square: Square | null;
  /** `wrong_phase`. */
  readonly phase: Phase | null;
  /** `insufficient_mana`. */
  readonly needed: number | null;
  readonly available: number | null;
  /** `invalid_target_count`. */
  readonly expected: number | null;
  readonly received: number | null;
  /** `illegal_position`: il re che resterebbe sotto scacco. */
  readonly king: Color | null;
  /** `invalid_target`: quale bersaglio (0-based) e perché (`effects/targets.go`, stringa aperta). */
  readonly index: number | null;
  readonly reason: string | null;
  /** `limit_reached`: cast ammessi per turno. */
  readonly perTurn: number | null;
}
