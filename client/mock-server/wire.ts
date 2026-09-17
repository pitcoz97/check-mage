/**
 * Forma sul filo dal punto di vista del "server" mock, ricavata da chess-server (commit 7f817e5).
 *
 * Scritta di proposito in modo indipendente da `src/`: se il mock condividesse i tipi del client,
 * un errore dell'adapter verrebbe mascherato invece che scoperto.
 */

export type WireColor = 'white' | 'black';
export type WirePhase = 'draw' | 'main1' | 'move' | 'main2' | 'end_turn';

/** Messaggi client → server gestiti da `game/room.go:268-310`. */
export const CLIENT_MESSAGE_TYPES = [
  'move',
  'resign',
  'draw_offer',
  'draw_accepted',
  'draw_declined',
  'pass_phase',
  'cast_spell',
] as const;
export type WireClientType = (typeof CLIENT_MESSAGE_TYPES)[number];

/** `models.WSMessage`: `payload` resta JSON grezzo fino al singolo handler. */
export interface WireClientMessage {
  type: string;
  payload: unknown;
}

/** Tipi server → client (`models/response.go:17-39` + letterali in `game/room.go`). */
export type WireServerType =
  | 'game_state'
  | 'hand'
  | 'card_drawn'
  | 'hand_size_changed'
  | 'mana_changed'
  | 'phase_changed'
  | 'spell_cast'
  | 'effect_expired'
  | 'timer_update'
  | 'game_over'
  | 'error'
  | 'draw_offer'
  | 'draw_offer_sent'
  | 'draw_declined'
  | 'opponent_disconnected'
  | 'opponent_reconnected';

export interface WireServerMessage {
  type: WireServerType;
  payload: Record<string, unknown>;
}
