/**
 * Protocollo WebSocket nella sua forma **interna**.
 *
 * Qui ci sono solo tipi e costanti: nessuna interpretazione dei payload.
 * La forma sul filo vive in `src/api/adapter.ts`.
 *
 * - A: intenti in uscita, cioè quello che la UI chiede di fare
 * - B: elenco chiuso dei `type` in entrata (chess-server `models/response.go:17-45` + `game/room.go`)
 * - C: eventi normalizzati, l'unica cosa che vede `applyServerEvent`
 * - D: esito della decodifica, che non lancia mai eccezioni
 */

import type { AdapterWarning } from '../api/adapter';
import type {
  AppliedEffect,
  Clocks,
  Color,
  ExpiredEffect,
  GameOverReason,
  GameResult,
  HandCard,
  ManaState,
  Phase,
  PrivateHand,
  ProtocolErrorInfo,
  PublicGameState,
  SpellId,
  Square,
  UciMove,
  Username,
} from '../game/model';

// ---------------------------------------------------------------------------------------------------
// A. Uscita (client → server) — `game/room.go:268-310`
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
      /** `[]` per `none`, `[casella]` per `*_piece`, `[from, to]` per `piece_move` (`spells/spells.go:37`). */
      readonly targets: readonly Square[];
    };

export type ClientIntentType = ClientIntent['type'];

// ---------------------------------------------------------------------------------------------------
// B. Entrata (server → client): tipi noti
// ---------------------------------------------------------------------------------------------------

export const SERVER_MESSAGE_TYPES = [
  'game_state',
  'hand',
  'card_drawn',
  'hand_size_changed',
  'mana_changed',
  'phase_changed',
  'spell_cast',
  'effect_expired',
  'timer_update',
  'game_over',
  'error',
  'draw_offer',
  'draw_offer_sent',
  'draw_declined',
  'opponent_disconnected',
  'opponent_reconnected',
] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

export function isServerMessageType(value: string): value is ServerMessageType {
  return (SERVER_MESSAGE_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------------
// C. Eventi normalizzati
// ---------------------------------------------------------------------------------------------------

export type ServerEvent =
  /** Stato pubblico completo: all'avvio, dopo ogni cambio di scacchiera e alla riconnessione. */
  | { readonly type: 'game_state'; readonly state: PublicGameState }
  /** Mano privata completa: all'avvio e alla riconnessione. */
  | { readonly type: 'hand'; readonly hand: PrivateHand }
  | { readonly type: 'card_drawn'; readonly card: HandCard; readonly deckSize: number | null }
  | { readonly type: 'hand_size_changed'; readonly player: Color; readonly size: number }
  | { readonly type: 'mana_changed'; readonly player: Color; readonly mana: ManaState }
  /** Può arrivarne più d'uno di fila, `draw` compresa (`match/match.go:232`). */
  | {
      readonly type: 'phase_changed';
      readonly phase: Phase | 'unknown';
      readonly activePlayer: Color;
      readonly turnNumber: number;
    }
  | {
      readonly type: 'spell_cast';
      readonly player: Color;
      readonly spellId: SpellId;
      readonly targets: readonly Square[];
      readonly effects: readonly AppliedEffect[];
    }
  | { readonly type: 'effect_expired'; readonly expired: ExpiredEffect }
  /** `turn` = giocatore di cui scorre il tempo, non il tratto scacchistico (`game/room.go:1083`). */
  | { readonly type: 'timer_update'; readonly clocks: Clocks; readonly turn: Color | 'unknown' }
  | {
      readonly type: 'game_over';
      readonly result: GameResult;
      readonly reason: GameOverReason;
      readonly winner: Username | null;
    }
  | { readonly type: 'error'; readonly error: ProtocolErrorInfo }
  | { readonly type: 'draw_offer'; readonly from: Username }
  // Testi del server scartati di proposito (briefing §2.5): restano solo i type.
  | { readonly type: 'draw_offer_sent' }
  | { readonly type: 'draw_declined' }
  | { readonly type: 'opponent_disconnected' }
  | { readonly type: 'opponent_reconnected' };

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
