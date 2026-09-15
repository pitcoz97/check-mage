/**
 * Forma sul filo dal punto di vista del "server" mock.
 *
 * Scritta di proposito in modo indipendente da `src/`: se il mock condividesse i tipi del client,
 * un errore dell'adapter verrebbe mascherato invece che scoperto. Riflette il contratto del briefing
 * §3.2–3.3 più le estensioni assunte in docs/ASSUMPTIONS.md (G1, G2, G4, G6, G8, A14).
 */

export type WireColor = 'white' | 'black';
export type WirePhase = 'draw' | 'main1' | 'move' | 'main2' | 'end_turn';

export interface WirePiece {
  piece_id: string;
  square: string;
  type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  color: WireColor;
  effects: { kind: string; remaining_turns: number }[];
}

export interface WireHandCard {
  card_id: string;
  spell_id?: string;
}

export interface WireMana {
  current: number;
  max: number;
}

export interface WireAppliedEffect {
  kind: string;
  piece_id?: string;
  square?: string;
  params: Record<string, unknown>;
}

export interface WireGameStart {
  room_id: string;
  white: string;
  black: string;
  fen: string;
  // --- estensioni assunte (G4) ---
  moves?: string[];
  white_time?: number;
  black_time?: number;
  time_control?: { initial_ms: number; increment_ms: number };
  pieces?: WirePiece[];
  phase?: WirePhase;
  active_player?: string;
  turn_number?: number;
  hand?: WireHandCard[];
  hand_sizes?: Record<string, number>;
  deck_sizes?: Record<string, number>;
  mana?: Record<string, WireMana>;
}

export type WireServerMessage =
  | { type: 'game_start'; payload: WireGameStart }
  | {
      type: 'game_state';
      payload: {
        board: { fen: string; moves: string[]; turn: WireColor; status: string };
        white_time: number;
        black_time: number;
        pieces?: WirePiece[];
      };
    }
  | { type: 'timer_update'; payload: { white_time: number; black_time: number; turn: WireColor } }
  | { type: 'game_over'; payload: { result: '1-0' | '0-1' | '1/2-1/2'; reason: string; winner: string | null } }
  | { type: 'draw_offer'; payload: { from: string } }
  | { type: 'opponent_disconnected'; payload: { message: string } }
  | { type: 'error'; payload: { code?: string; message: string } }
  | { type: 'phase_changed'; payload: { phase: WirePhase; active_player: string; turn_number: number } }
  | { type: 'card_drawn'; payload: WireHandCard }
  | { type: 'hand_size_changed'; payload: { player: string; size: number; deck_size?: number } }
  | { type: 'mana_changed'; payload: { player: string; current: number; max: number } }
  | {
      type: 'spell_cast';
      payload: { player: string; spell_id: string; targets: string[]; effects_applied: WireAppliedEffect[] };
    }
  | { type: 'effect_applied'; payload: { piece_id: string; effect_kind: string; remaining_turns: number } }
  | { type: 'effect_expired'; payload: { piece_id: string; effect_kind: string } };

export type WireServerType = WireServerMessage['type'];

/** Messaggi client → server riconosciuti dal mock. */
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

export interface WireClientMessage {
  type: WireClientType;
  payload: Record<string, unknown>;
}

/** Codici d'errore del mock (ASSUMPTIONS.md M11). */
export type ErrorCode =
  | 'malformed_message'
  | 'unknown_message_type'
  | 'no_active_game'
  | 'not_your_turn'
  | 'wrong_phase'
  | 'illegal_move'
  | 'piece_frozen'
  | 'target_shielded'
  | 'insufficient_mana'
  | 'card_not_in_hand'
  | 'unknown_spell'
  | 'invalid_target'
  | 'no_draw_offer';

/** Testi volutamente in italiano, come il server reale (briefing §2.5): il client non deve mostrarli. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  malformed_message: 'Messaggio malformato',
  unknown_message_type: 'Tipo di messaggio sconosciuto',
  no_active_game: 'Nessuna partita in corso',
  not_your_turn: 'Non è il tuo turno',
  wrong_phase: 'Azione non consentita in questa fase',
  illegal_move: 'Mossa illegale',
  piece_frozen: 'Il pezzo è congelato',
  target_shielded: 'Il bersaglio è protetto',
  insufficient_mana: 'Mana insufficiente',
  card_not_in_hand: 'Carta non presente in mano',
  unknown_spell: 'Magia sconosciuta',
  invalid_target: 'Bersaglio non valido',
  no_draw_offer: 'Nessuna offerta di patta pendente',
};

export function errorMessage(code: ErrorCode): WireServerMessage {
  return { type: 'error', payload: { code, message: ERROR_MESSAGES[code] } };
}
