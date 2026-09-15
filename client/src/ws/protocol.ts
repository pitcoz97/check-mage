/**
 * Protocollo WebSocket nella sua forma **interna**.
 *
 * Qui ci sono solo tipi e costanti: nessuna interpretazione dei payload.
 * La forma sul filo e ogni assunzione sul server vivono in `src/api/adapter.ts`.
 *
 * - A: intenti in uscita, cioè quello che la UI chiede di fare
 * - B: elenco chiuso dei `type` in entrata (briefing §3.2 + §3.3)
 * - C: eventi normalizzati, l'unica cosa che vede `applyServerEvent`
 * - D: esito della decodifica, che non lancia mai eccezioni
 */

import type { AdapterWarning } from '../api/adapter';
import type {
  ActiveEffect,
  AppliedEffect,
  BoardStatus,
  Clocks,
  Color,
  GameOverReason,
  GameResult,
  HandCard,
  ManaState,
  MatchSnapshot,
  Phase,
  PieceId,
  PieceState,
  ProtocolErrorInfo,
  SpellId,
  Square,
  UciMove,
  Username,
} from '../game/model';

// ---------------------------------------------------------------------------------------------------
// A. Uscita (client → server)
// ---------------------------------------------------------------------------------------------------

export type ClientIntent =
  | { readonly type: 'move'; readonly move: UciMove }
  | { readonly type: 'resign' }
  | { readonly type: 'draw_offer' }
  | { readonly type: 'draw_accepted' }
  | { readonly type: 'draw_declined' }
  | { readonly type: 'pass_phase' }
  | {
      readonly type: 'cast_spell';
      readonly card: HandCard;
      /** Ordine semantico: `[bersaglio]` oppure `[origine, destinazione]`. Vuoto per `target_type: none`. */
      readonly targets: readonly Square[];
    };

export type ClientIntentType = ClientIntent['type'];

// ---------------------------------------------------------------------------------------------------
// B. Entrata (server → client): tipi noti
// ---------------------------------------------------------------------------------------------------

export const SERVER_MESSAGE_TYPES = [
  'game_start',
  'game_state',
  'timer_update',
  'game_over',
  'draw_offer',
  'opponent_disconnected',
  'error',
  'phase_changed',
  'card_drawn',
  'hand_size_changed',
  'mana_changed',
  'spell_cast',
  'effect_applied',
  'effect_expired',
] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

export function isServerMessageType(value: string): value is ServerMessageType {
  return (SERVER_MESSAGE_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------------
// C. Eventi normalizzati
// ---------------------------------------------------------------------------------------------------

export type ServerEvent =
  /** Inizio partita, e anche la riconnessione (G5): sostituisce l'intero stato. */
  | { readonly type: 'game_start'; readonly snapshot: MatchSnapshot }
  | {
      readonly type: 'game_state';
      readonly fen: string;
      readonly moves: readonly UciMove[];
      /** Lato che deve muovere secondo la FEN: può differire dal giocatore attivo in `main2`. */
      readonly turn: Color | 'unknown';
      readonly status: BoardStatus;
      readonly clocks: Clocks | null;
      /** `null` se il server non fornisce il mapping dei pezzi (G1). */
      readonly pieces: readonly PieceState[] | null;
    }
  | { readonly type: 'timer_update'; readonly clocks: Clocks; readonly turn: Color | 'unknown' }
  | {
      readonly type: 'game_over';
      readonly result: GameResult;
      readonly reason: GameOverReason;
      readonly winner: Username | null;
    }
  | { readonly type: 'draw_offer'; readonly from: Username }
  /** Il testo del server viene scartato di proposito (briefing §2.5). */
  | { readonly type: 'opponent_disconnected' }
  | { readonly type: 'error'; readonly error: ProtocolErrorInfo }
  | {
      readonly type: 'phase_changed';
      readonly phase: Phase | 'unknown';
      readonly activePlayer: Username;
      readonly turnNumber: number;
    }
  | { readonly type: 'card_drawn'; readonly card: HandCard }
  | {
      readonly type: 'hand_size_changed';
      readonly player: Username;
      readonly size: number;
      /** `null` se il server non la invia (A14). */
      readonly deckSize: number | null;
    }
  | { readonly type: 'mana_changed'; readonly player: Username; readonly mana: ManaState }
  | {
      readonly type: 'spell_cast';
      readonly player: Username;
      readonly spellId: SpellId;
      readonly targets: readonly Square[];
      readonly effects: readonly AppliedEffect[];
    }
  | { readonly type: 'effect_applied'; readonly pieceId: PieceId; readonly effect: ActiveEffect }
  | { readonly type: 'effect_expired'; readonly pieceId: PieceId; readonly effectKind: string };

export type ServerEventOf<K extends ServerMessageType> = Extract<ServerEvent, { type: K }>;

// Guardia a compile-time: l'elenco B e l'unione C devono coincidere in entrambe le direzioni.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const protocolInSync: Equals<ServerEvent['type'], ServerMessageType> = true;
void protocolInSync;

/** Da usare nel `default` di ogni `switch` su `ServerEvent['type']`: un caso dimenticato non compila. */
export function assertNever(value: never): never {
  throw new Error(`Caso non gestito: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------------
// D. Esito della decodifica
// ---------------------------------------------------------------------------------------------------

export type DecodeFailure =
  | { readonly kind: 'invalid_json' }
  | { readonly kind: 'not_an_envelope' }
  | { readonly kind: 'unknown_type'; readonly type: string }
  | { readonly kind: 'malformed_payload'; readonly type: ServerMessageType; readonly issues: readonly string[] };

export type DecodeResult =
  | { readonly ok: true; readonly event: ServerEvent; readonly warnings: readonly AdapterWarning[] }
  | { readonly ok: false; readonly failure: DecodeFailure };
