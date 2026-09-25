/**
 * Protocollo WebSocket nella sua forma **interna**.
 *
 * Qui ci sono solo tipi e costanti: nessuna interpretazione dei payload.
 * La forma sul filo vive in `src/api/adapter.ts`.
 *
 * - A: intenti in uscita, cioè quello che la UI chiede di fare
 * - B: elenco chiuso dei `type` in entrata (chess-server `models/response.go:17-48`)
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
  PieceKind,
  PrivateHand,
  ProtocolErrorInfo,
  PublicGameState,
  RuneResult,
  SpellId,
  Square,
  SquareEffects,
  UciMove,
  Username,
} from '../game/model';

// ---------------------------------------------------------------------------------------------------
// A. Uscita (client → server) — `game/room.go:365-408`
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
      /** Una casella per ogni bersaglio della magia, nell'ordine di `spell.targets`. */
      readonly targets: readonly Square[];
      /** Pezzo scelto per promozione o ritorno dal cimitero; `null` se la magia non chiede nulla. */
      readonly choice: PieceKind | null;
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
  'graveyard_changed',
  'square_effects_changed',
  'rune_triggered',
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

export const DRAW_DECLINE_REASONS = ['declined', 'move_played'] as const;
export type DrawDeclineReason = (typeof DRAW_DECLINE_REASONS)[number] | 'unknown';

export type ServerEvent =
  /** Stato pubblico completo: all'avvio, dopo ogni cambio di scacchiera e alla riconnessione; a fine partita arriva
   *  prima di `game_over`, con lo status finale. */
  | { readonly type: 'game_state'; readonly state: PublicGameState }
  /** Mano privata completa: all'avvio e alla riconnessione. */
  | { readonly type: 'hand'; readonly hand: PrivateHand }
  | { readonly type: 'card_drawn'; readonly card: HandCard; readonly deckSize: number | null }
  | { readonly type: 'hand_size_changed'; readonly player: Color; readonly size: number }
  | { readonly type: 'mana_changed'; readonly player: Color; readonly mana: ManaState }
  /** Può arrivarne più d'uno di fila, `draw` compresa (`match/match.go:231`). */
  | {
      readonly type: 'phase_changed';
      readonly phase: Phase | 'unknown';
      readonly activePlayer: Color;
      readonly turnNumber: number;
    }
  | {
      readonly type: 'spell_cast';
      readonly player: Color;
      /** `null` per una magia nascosta dell'avversario: né carta né bersagli (ASSUMPTIONS M42). */
      readonly spellId: SpellId | null;
      readonly targets: readonly Square[];
      readonly effects: readonly AppliedEffect[];
    }
  | { readonly type: 'effect_expired'; readonly expired: ExpiredEffect }
  /** Il cimitero di un giocatore è cambiato: la lista intera, in ordine. */
  | { readonly type: 'graveyard_changed'; readonly player: Color; readonly graveyard: readonly PieceKind[] }
  /** Gli stati delle case sono cambiati (creati, rivelati, consumati o scaduti): la lista intera, vista da me. */
  | { readonly type: 'square_effects_changed'; readonly squareStates: readonly SquareEffects[] }
  /** Una runa è scattata; lo stato aggiornato arriva con `game_state` e `square_effects_changed`. */
  | { readonly type: 'rune_triggered'; readonly square: Square; readonly owner: Color; readonly onEnter: string; readonly result: RuneResult }
  /** `turn` = giocatore di cui scorre il tempo, non il tratto scacchistico (`game/room.go:1331-1340`). */
  | { readonly type: 'timer_update'; readonly clocks: Clocks; readonly turn: Color | 'unknown' }
  | {
      readonly type: 'game_over';
      readonly result: GameResult;
      readonly reason: GameOverReason;
      readonly winner: Username | null;
    }
  | { readonly type: 'error'; readonly error: ProtocolErrorInfo }
  | { readonly type: 'draw_offer'; readonly from: Username }
  /**
   * All'autore dell'offerta: rifiutata, oppure decaduta perché l'avversario ha mosso (`game/room.go:556-561,1495-1500`).
   * Chi aveva ricevuto l'offerta non viene avvisato quando decade: la scarta da sé dopo la propria mossa.
   */
  | { readonly type: 'draw_declined'; readonly reason: DrawDeclineReason }
  // Testi del server scartati di proposito (briefing §2.5): restano solo i type.
  | { readonly type: 'draw_offer_sent' }
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
