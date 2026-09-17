/**
 * Adapter: l'UNICO punto del client che interpreta i payload grezzi del server.
 *
 * Fonte del contratto: il codice di chess-server (`internal/`, commit 7f817e5), citato come `file.go:riga`.
 * Ciò che il codice non determina è in docs/ASSUMPTIONS.md: quelle voci vivono qui e generano warning
 * etichettati con il loro id. Se ti accorgi di stare normalizzando un payload altrove, fermati.
 *
 * Sezioni:
 *   §1 Registro assunzioni e warning
 *   §2 Letture tolleranti del filo
 *   §3 Decoder WebSocket in entrata
 *   §3b Testi d'errore WebSocket → codici
 *   §4 Encoder WebSocket in uscita
 *   §5 REST: inviluppo, testi d'errore, normalizzatori, encoder, policy credenziali
 *   §7 Catalogo magie
 *
 * Regole: non lancia mai eccezioni su input del server, un campo sconosciuto viene ignorato, e il testo
 * libero del server non esce mai da qui.
 */

import { z } from 'zod';

import {
  BOARD_STATUSES,
  COLORS,
  GAME_OVER_REASONS,
  GAME_RESULTS,
  PHASES,
  PIECE_KINDS,
  PROTOCOL_ERROR_CODES,
  type ActiveEffect,
  type AppliedEffect,
  type ExpiredEffect,
  type HandCard,
  type MatchPlayers,
  type PerColor,
  type PieceKind,
  type ProtocolErrorCode,
  type ProtocolErrorInfo,
  type Square,
  type SquareEffects,
} from '../game/model';
import { spellSchema, type Spell } from '../spells/schema';
import {
  assertNever,
  isServerMessageType,
  type ClientIntent,
  type DecodeResult,
  type ServerEventOf,
  type ServerMessageType,
} from '../ws/protocol';
import type {
  AuthSession,
  GameHistoryEntry,
  HttpErrorCode,
  HttpErrorInfo,
  LeaderboardEntry,
  PublicProfile,
  Registration,
  ServerStatus,
  TokenPair,
  UserAccount,
} from './types';

// ===================================================================================================
// §1 Registro assunzioni e warning
// ===================================================================================================

export type AssumptionId = 'G1' | 'G8' | 'G10' | 'A15' | 'C1' | 'C2' | 'C3' | 'C4';

/** Ogni warning è legato all'assunzione che l'ha generato, così un log porta a ASSUMPTIONS.md. */
const WARNING_ASSUMPTION = {
  active_effect_malformed: 'G1',
  effect_unknown: 'G8',
  catalog_shape_unexpected: 'G10',
  catalog_entry_invalid: 'G10',
  enum_unknown: 'A15',
  number_out_of_range: 'A15',
  value_invalid: 'A15',
  players_missing: 'C1',
  error_code_unknown: 'C2',
  error_text_unknown: 'C4',
  http_error_text_unknown: 'C4',
} as const satisfies Record<string, AssumptionId>;

export type AdapterWarningCode = keyof typeof WARNING_ASSUMPTION;

export interface AdapterWarning {
  readonly code: AdapterWarningCode;
  readonly assumption: AssumptionId;
  readonly detail?: string;
}

export interface DecodeOptions {
  /** Generatore di id d'istanza locali per le carte (ASSUMPTIONS G2). Iniettabile nei test. */
  readonly newLocalId?: () => string;
}

interface Ctx {
  readonly warnings: AdapterWarning[];
  readonly newLocalId: () => string;
}

function createCtx(options?: DecodeOptions): Ctx {
  return {
    warnings: [],
    newLocalId: options?.newLocalId ?? (() => `local-${globalThis.crypto.randomUUID()}`),
  };
}

function warn(ctx: Ctx, code: AdapterWarningCode, detail?: string): void {
  const base = { code, assumption: WARNING_ASSUMPTION[code] };
  ctx.warnings.push(detail === undefined ? base : { ...base, detail });
}

// ===================================================================================================
// §2 Letture tolleranti del filo
// ===================================================================================================

type Parsed<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly issues: string[] };

function parseWith<S extends z.ZodType>(schema: S, value: unknown): Parsed<z.output<S>> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(payload)'}: ${issue.message}`),
  };
}

const nonEmptyString = z.string().min(1);
/** Campo letto dopo con regole proprie (enum aperti, liste tolleranti): lo schema del nucleo non lo vincola. */
const loose = z.unknown().optional();
/** Gli id numerici del server (`int` in Go) diventano stringhe opache. */
const wireId = z.union([z.number().int(), nonEmptyString]).transform((id) => String(id));
const count = z.number().int();
/** Le slice nil di Go arrivano come `null` (BACKEND-REQUESTS B8). */
const nullableList = <S extends z.ZodType>(item: S) =>
  z
    .array(item)
    .nullable()
    .optional()
    .transform((list) => list ?? []);

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

const squareSchema = z.custom<Square>(isSquare, 'casella non valida');
const colorSchema = z.enum(['white', 'black']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(known: readonly T[], value: unknown): value is T {
  return known.some((candidate) => candidate === value);
}

/** Enum aperto: un valore non previsto diventa `'unknown'` (A15). */
function readEnum<T extends string>(ctx: Ctx, value: unknown, known: readonly T[], field: string): T | 'unknown' {
  if (isOneOf(known, value)) return value;
  warn(ctx, 'enum_unknown', `${field}=${JSON.stringify(value)}`);
  return 'unknown';
}

/** Numero non negativo: i valori negativi vengono portati a 0 (A15). */
function clampNonNegative(ctx: Ctx, value: number, field: string): number {
  if (value >= 0) return value;
  warn(ctx, 'number_out_of_range', `${field}=${value}`);
  return 0;
}

// --- Effetti persistenti per casella (`effects/tracker.go:242-267`) ------------------------------

const wireActiveEffectSchema = z.object({
  kind: nonEmptyString,
  remaining_turns: count,
  source_spell_id: z.string().optional(),
});
const wireSquareEffectsSchema = z.object({ square: squareSchema, effects: z.array(wireActiveEffectSchema) });

function decodeActiveEffects(ctx: Ctx, raw: unknown): SquareEffects[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(ctx, 'active_effect_malformed', 'active_effects non è un array');
    return [];
  }
  const out: SquareEffects[] = [];
  raw.forEach((item: unknown, index) => {
    const parsed = parseWith(wireSquareEffectsSchema, item);
    if (!parsed.ok) {
      warn(ctx, 'active_effect_malformed', `active_effects[${index}]: ${parsed.issues.join('; ')}`);
      return;
    }
    const effects: ActiveEffect[] = parsed.data.effects.map((effect) => ({
      kind: effect.kind,
      remainingTurns: clampNonNegative(ctx, effect.remaining_turns, 'remaining_turns'),
      sourceSpellId: effect.source_spell_id !== undefined && effect.source_spell_id !== '' ? effect.source_spell_id : null,
    }));
    out.push({ square: parsed.data.square, effects });
  });
  return out;
}

// --- Identità dei giocatori (P0-5, ASSUMPTIONS C1) -----------------------------------------------

const wirePlayerSchema = z.object({ id: wireId, username: nonEmptyString });

function decodePlayers(ctx: Ctx, white: unknown, black: unknown): MatchPlayers | null {
  const w = parseWith(wirePlayerSchema, white);
  const b = parseWith(wirePlayerSchema, black);
  if (w.ok && b.ok) return { white: w.data, black: b.data };
  warn(ctx, 'players_missing');
  return null;
}

// --- Effetti applicati (`game/room.go:583-661`) ----------------------------------------------------

const PIECE_NAMES: readonly PieceKind[] = PIECE_KINDS;

const APPLIED_EFFECT_SCHEMAS = {
  noop: z.object({}),
  destroy_piece: z.object({ target: squareSchema, piece_destroyed: loose }),
  freeze_piece: z.object({ target: squareSchema, remaining_turns: count }),
  shield_piece: z.object({ target: squareSchema, remaining_turns: count }),
  move_piece: z.object({ from: squareSchema, to: squareSchema }),
  draw_card: z.object({ count }),
  gain_mana: z.object({ amount: count, mana: count }),
} as const;

function decodeAppliedEffect(ctx: Ctx, raw: unknown, index: number): AppliedEffect {
  const kind = isRecord(raw) && typeof raw['kind'] === 'string' ? raw['kind'] : '';
  const unknown = (detail: string): AppliedEffect => {
    warn(ctx, 'effect_unknown', `effects_applied[${index}]: ${detail}`);
    return { kind: 'unknown', rawKind: kind };
  };
  switch (kind) {
    case 'noop':
      return { kind: 'noop' };
    case 'destroy_piece': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.destroy_piece, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      const destroyed = p.data.piece_destroyed;
      return {
        kind,
        target: p.data.target,
        destroyedPiece: isOneOf(PIECE_NAMES, destroyed) ? destroyed : readEnum(ctx, destroyed, PIECE_NAMES, 'piece_destroyed'),
      };
    }
    case 'freeze_piece':
    case 'shield_piece': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS[kind], raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      return { kind, target: p.data.target, remainingTurns: clampNonNegative(ctx, p.data.remaining_turns, 'remaining_turns') };
    }
    case 'move_piece': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.move_piece, raw);
      return p.ok ? { kind, from: p.data.from, to: p.data.to } : unknown(p.issues.join('; '));
    }
    case 'draw_card': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.draw_card, raw);
      return p.ok ? { kind, count: clampNonNegative(ctx, p.data.count, 'count') } : unknown(p.issues.join('; '));
    }
    case 'gain_mana': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.gain_mana, raw);
      return p.ok
        ? { kind, amount: p.data.amount, manaAfter: clampNonNegative(ctx, p.data.mana, 'mana') }
        : unknown(p.issues.join('; '));
    }
    default:
      return unknown(`kind sconosciuto ${JSON.stringify(kind)}`);
  }
}

function toHandCard(ctx: Ctx, spellId: string): HandCard {
  return { instanceId: ctx.newLocalId(), spellId };
}

// ===================================================================================================
// §3 Decoder WebSocket in entrata
// ===================================================================================================

type DecoderOutput<K extends ServerMessageType> =
  | { readonly ok: true; readonly event: ServerEventOf<K> }
  | { readonly ok: false; readonly issues: string[] };

type Decoder<K extends ServerMessageType> = (payload: unknown, ctx: Ctx) => DecoderOutput<K>;

/** Esegue lo schema del nucleo e, se valido, costruisce l'evento. */
function withCore<S extends z.ZodType, K extends ServerMessageType>(
  schema: S,
  payload: unknown,
  build: (data: z.output<S>) => ServerEventOf<K>,
): DecoderOutput<K> {
  const parsed = parseWith(schema, payload);
  return parsed.ok ? { ok: true, event: build(parsed.data) } : { ok: false, issues: parsed.issues };
}

// Eventi senza dati utili: il testo del server (`{message}`) viene scartato di proposito (briefing §2.5).
const decodeDrawOfferSent: Decoder<'draw_offer_sent'> = () => ({ ok: true, event: { type: 'draw_offer_sent' } });
const decodeDrawDeclined: Decoder<'draw_declined'> = () => ({ ok: true, event: { type: 'draw_declined' } });
const decodeOpponentDisconnected: Decoder<'opponent_disconnected'> = () => ({
  ok: true,
  event: { type: 'opponent_disconnected' },
});
const decodeOpponentReconnected: Decoder<'opponent_reconnected'> = () => ({
  ok: true,
  event: { type: 'opponent_reconnected' },
});

const manaNumber = z.number();

// `game/room.go:1101-1119` (+ `reconnected` da `game/room.go:924`, + P0-5 in contratto `proposed`).
const gameStateSchema = z.object({
  board: z.object({
    fen: nonEmptyString,
    moves: nullableList(z.string()),
    turn: loose,
    status: loose,
  }),
  white_time: z.number(),
  black_time: z.number(),
  phase: loose,
  active_player: loose,
  turn_number: count,
  white_mana: manaNumber,
  white_max_mana: manaNumber,
  black_mana: manaNumber,
  black_max_mana: manaNumber,
  white_hand_size: count,
  black_hand_size: count,
  white_deck_size: count,
  black_deck_size: count,
  active_effects: loose,
  reconnected: loose,
  white_player: loose,
  black_player: loose,
});

const decodeGameState: Decoder<'game_state'> = (payload, ctx) =>
  withCore(gameStateSchema, payload, (core) => {
    const n = (value: number, field: string) => clampNonNegative(ctx, value, field);
    const perColor = <T>(white: T, black: T): PerColor<T> => ({ white, black });
    return {
      type: 'game_state',
      state: {
        fen: core.board.fen,
        moves: core.board.moves,
        turn: readEnum(ctx, core.board.turn, COLORS, 'board.turn'),
        status: readEnum(ctx, core.board.status, BOARD_STATUSES, 'board.status'),
        clocks: perColor(n(core.white_time, 'white_time'), n(core.black_time, 'black_time')),
        phase: readEnum(ctx, core.phase, PHASES, 'phase'),
        activePlayer: readEnum(ctx, core.active_player, COLORS, 'active_player'),
        turnNumber: n(core.turn_number, 'turn_number'),
        mana: perColor(
          { current: n(core.white_mana, 'white_mana'), max: n(core.white_max_mana, 'white_max_mana') },
          { current: n(core.black_mana, 'black_mana'), max: n(core.black_max_mana, 'black_max_mana') },
        ),
        handSizes: perColor(n(core.white_hand_size, 'white_hand_size'), n(core.black_hand_size, 'black_hand_size')),
        deckSizes: perColor(n(core.white_deck_size, 'white_deck_size'), n(core.black_deck_size, 'black_deck_size')),
        activeEffects: decodeActiveEffects(ctx, core.active_effects),
        reconnected: core.reconnected === true,
        players: decodePlayers(ctx, core.white_player, core.black_player),
      },
    };
  });

// `game/room.go:827-842`
const decodeHand: Decoder<'hand'> = (payload, ctx) =>
  withCore(
    z.object({ hand: nullableList(nonEmptyString), mana: manaNumber, max_mana: manaNumber, deck_size: count }),
    payload,
    (core) => ({
      type: 'hand',
      hand: {
        cards: core.hand.map((spellId) => toHandCard(ctx, spellId)),
        mana: { current: clampNonNegative(ctx, core.mana, 'mana'), max: clampNonNegative(ctx, core.max_mana, 'max_mana') },
        deckSize: clampNonNegative(ctx, core.deck_size, 'deck_size'),
      },
    }),
  );

// `game/room.go:805-808`, `549-553`: `card_id` è lo spell_id.
const decodeCardDrawn: Decoder<'card_drawn'> = (payload, ctx) =>
  withCore(z.object({ card_id: nonEmptyString, deck_size: count.optional() }), payload, (core) => ({
    type: 'card_drawn',
    card: toHandCard(ctx, core.card_id),
    deckSize: core.deck_size === undefined ? null : clampNonNegative(ctx, core.deck_size, 'deck_size'),
  }));

const decodeHandSizeChanged: Decoder<'hand_size_changed'> = (payload, ctx) =>
  withCore(z.object({ player: colorSchema, size: count }), payload, (core) => ({
    type: 'hand_size_changed',
    player: core.player,
    size: clampNonNegative(ctx, core.size, 'size'),
  }));

const decodeManaChanged: Decoder<'mana_changed'> = (payload, ctx) =>
  withCore(z.object({ player: colorSchema, current: manaNumber, max: manaNumber }), payload, (core) => ({
    type: 'mana_changed',
    player: core.player,
    mana: { current: clampNonNegative(ctx, core.current, 'current'), max: clampNonNegative(ctx, core.max, 'max') },
  }));

const decodePhaseChanged: Decoder<'phase_changed'> = (payload, ctx) =>
  withCore(z.object({ phase: loose, active_player: colorSchema, turn_number: count }), payload, (core) => ({
    type: 'phase_changed',
    phase: readEnum(ctx, core.phase, PHASES, 'phase'),
    activePlayer: core.active_player,
    turnNumber: clampNonNegative(ctx, core.turn_number, 'turn_number'),
  }));

// `game/room.go:535-540`. `targets` ed `effects_applied` possono essere `null` (slice nil in Go).
const decodeSpellCast: Decoder<'spell_cast'> = (payload, ctx) =>
  withCore(
    z.object({ player: colorSchema, spell_id: nonEmptyString, targets: nullableList(z.unknown()), effects_applied: loose }),
    payload,
    (core) => {
      const targets = core.targets.filter(isSquare);
      if (targets.length !== core.targets.length) warn(ctx, 'value_invalid', 'spell_cast.targets');
      const rawEffects = core.effects_applied;
      const list: unknown[] = Array.isArray(rawEffects) ? rawEffects : [];
      if (rawEffects !== undefined && rawEffects !== null && !Array.isArray(rawEffects)) {
        warn(ctx, 'effect_unknown', 'effects_applied non è un array');
      }
      return {
        type: 'spell_cast',
        player: core.player,
        spellId: core.spell_id,
        targets,
        effects: list.map((effect, index) => decodeAppliedEffect(ctx, effect, index)),
      };
    },
  );

// `game/room.go:422-426` (scudo consumato) e `732-736` (scadenza).
const decodeEffectExpired: Decoder<'effect_expired'> = (payload, ctx) =>
  withCore(
    z.object({ square: squareSchema, effect_kind: nonEmptyString, piece_id: wireId.optional(), reason: loose }),
    payload,
    (core) => {
      let reason: ExpiredEffect['reason'] = 'expired';
      if (core.reason === 'shield_absorbed') reason = 'shield_absorbed';
      else if (core.reason !== undefined) {
        warn(ctx, 'enum_unknown', `effect_expired.reason=${JSON.stringify(core.reason)}`);
        reason = 'unknown';
      }
      return {
        type: 'effect_expired',
        expired: { square: core.square, kind: core.effect_kind, pieceId: core.piece_id ?? null, reason },
      };
    },
  );

const decodeTimerUpdate: Decoder<'timer_update'> = (payload, ctx) =>
  withCore(z.object({ white_time: z.number(), black_time: z.number(), turn: loose }), payload, (core) => ({
    type: 'timer_update',
    clocks: {
      white: clampNonNegative(ctx, core.white_time, 'white_time'),
      black: clampNonNegative(ctx, core.black_time, 'black_time'),
    },
    turn: readEnum(ctx, core.turn, COLORS, 'turn'),
  }));

// `game/room.go:1022-1029`: `winner` assente in caso di patta.
const decodeGameOver: Decoder<'game_over'> = (payload, ctx) =>
  withCore(z.object({ result: loose, reason: loose, winner: loose }), payload, (core) => ({
    type: 'game_over',
    result: readEnum(ctx, core.result, GAME_RESULTS, 'result'),
    reason: readEnum(ctx, core.reason, GAME_OVER_REASONS, 'reason'),
    winner: typeof core.winner === 'string' && core.winner.length > 0 ? core.winner : null,
  }));

const decodeDrawOffer: Decoder<'draw_offer'> = (payload) =>
  withCore(z.object({ from: nonEmptyString }), payload, (core) => ({ type: 'draw_offer', from: core.from }));

// `error` non fallisce mai, qualunque sia il payload.
const decodeError: Decoder<'error'> = (payload, ctx) => ({
  ok: true,
  event: { type: 'error', error: interpretWsError(ctx, payload) },
});

/** Un type aggiunto a SERVER_MESSAGE_TYPES senza decoder qui è un errore di compilazione. */
const DECODERS: { readonly [K in ServerMessageType]: Decoder<K> } = {
  game_state: decodeGameState,
  hand: decodeHand,
  card_drawn: decodeCardDrawn,
  hand_size_changed: decodeHandSizeChanged,
  mana_changed: decodeManaChanged,
  phase_changed: decodePhaseChanged,
  spell_cast: decodeSpellCast,
  effect_expired: decodeEffectExpired,
  timer_update: decodeTimerUpdate,
  game_over: decodeGameOver,
  error: decodeError,
  draw_offer: decodeDrawOffer,
  draw_offer_sent: decodeDrawOfferSent,
  draw_declined: decodeDrawDeclined,
  opponent_disconnected: decodeOpponentDisconnected,
  opponent_reconnected: decodeOpponentReconnected,
};

function runDecoder<K extends ServerMessageType>(type: K, payload: unknown, ctx: Ctx): DecoderOutput<K> {
  const decoder: Decoder<K> = DECODERS[type];
  return decoder(payload, ctx);
}

/** Decodifica un frame WebSocket testuale. Non lancia mai eccezioni. */
export function decodeServerMessage(raw: string, options?: DecodeOptions): DecodeResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { ok: false, failure: { kind: 'invalid_json' } };
  }
  if (!isRecord(envelope) || typeof envelope['type'] !== 'string') {
    return { ok: false, failure: { kind: 'not_an_envelope' } };
  }
  const type = envelope['type'];
  if (!isServerMessageType(type)) {
    return { ok: false, failure: { kind: 'unknown_type', type } };
  }
  const ctx = createCtx(options);
  const output = runDecoder(type, envelope['payload'], ctx);
  if (!output.ok) {
    return { ok: false, failure: { kind: 'malformed_payload', type, issues: output.issues } };
  }
  return { ok: true, event: output.event, warnings: ctx.warnings };
}

// ===================================================================================================
// §3b Testi d'errore WebSocket → codici (ASSUMPTIONS C4)
// ===================================================================================================

interface ErrorTextRule<C extends string> {
  readonly pattern: RegExp;
  readonly code: C;
  /** Estrae i dettagli numerici o la casella dai gruppi nominati `square`, `needed`, `available`. */
  readonly details?: true;
}

/**
 * Testi esatti del server. L'ordine conta: le regole più specifiche vengono prima.
 * Ogni voce cita il punto del codice Go che produce il testo.
 */
export const WS_ERROR_TEXTS: readonly ErrorTextRule<ProtocolErrorCode>[] = [
  { pattern: /^mossa illegale: lascerebbe il re sotto scacco$/, code: 'exposes_own_king' }, // game/room.go:654
  { pattern: /^Mossa illegale: \S+$/, code: 'illegal_move' }, // game/room.go:330
  { pattern: /^[Nn]on è il tuo turno$/, code: 'not_your_turn' }, // game/room.go:318,443; match/match.go:303
  { pattern: /^Non puoi muovere nella fase \S+$/, code: 'wrong_phase' }, // game/room.go:324
  { pattern: /^Non puoi passare nella fase \S+$/, code: 'wrong_phase' }, // game/room.go:449
  { pattern: /^non puoi castare magie nella fase \S+$/, code: 'wrong_phase' }, // match/match.go:306
  { pattern: /^.+ non è giocabile nella fase \S+$/, code: 'wrong_phase' }, // match/match.go:314
  { pattern: /^Il pezzo in (?<square>[a-h][1-8]) è congelato$/, code: 'piece_frozen', details: true }, // game/room.go:339
  { pattern: /^Formato (mossa|cast_spell|messaggio) non valido$/, code: 'malformed_message' }, // game/room.go:276,290; game/client.go:70
  { pattern: /^Tipo messaggio sconosciuto: .*$/, code: 'unknown_message_type' }, // game/room.go:308
  { pattern: /^Stai inviando messaggi troppo velocemente$/, code: 'rate_limited' }, // game/client.go:64
  { pattern: /^C'è già un'offerta di patta in corso$/, code: 'draw_offer_pending' }, // game/room.go:1149
  { pattern: /^Nessuna offerta di patta in corso$/, code: 'no_draw_offer' }, // game/room.go:1179
  { pattern: /^Non puoi rispondere alla tua stessa offerta$/, code: 'own_draw_offer' }, // game/room.go:1186
  { pattern: /^Sei già in coda$/, code: 'already_queued' }, // game/manager.go:60
  { pattern: /^magia sconosciuta: .*$/, code: 'unknown_spell' }, // match/match.go:311
  { pattern: /^carta non in mano$/, code: 'card_not_in_hand' }, // match/match.go:320
  {
    pattern: /^mana insufficiente: servono (?<needed>\d+), hai (?<available>-?\d+)$/,
    code: 'insufficient_mana',
    details: true,
  }, // match/match.go:323
  { pattern: /^la magia .+ richiede \d+ bersagli, ricevuti \d+$/, code: 'wrong_target_count' }, // match/match.go:326
  { pattern: /^la magia .+ richiede (un bersaglio|casella di partenza e arrivo)$/, code: 'wrong_target_count' }, // game/room.go:588,646
  {
    pattern: /^nessun pezzo (da (distruggere|congelare|proteggere|spostare) )?in (?<square>[a-h][1-8])$/,
    code: 'no_piece_on_target',
    details: true,
  }, // effects/effects.go:191,229; effects/tracker.go:138,157,168
  { pattern: /^non puoi (distruggere|congelare) un tuo pezzo \((?<square>[a-h][1-8])\)$/, code: 'target_must_be_enemy', details: true }, // effects/effects.go:194; effects/tracker.go:159
  { pattern: /^puoi (proteggere|spostare) solo i tuoi pezzi \((?<square>[a-h][1-8])\)$/, code: 'target_must_be_own', details: true }, // effects/tracker.go:171; effects/effects.go:232
  { pattern: /^il re non può essere distrutto$/, code: 'king_not_targetable' }, // effects/effects.go:197
  { pattern: /^la casella (?<square>[a-h][1-8]) non è vuota$/, code: 'destination_occupied', details: true }, // effects/effects.go:235
  { pattern: /^casella (non valida|fuori scacchiera): .*$/, code: 'invalid_square' }, // effects/effects.go:25,29
  { pattern: /^effetto non supportato: .*$/, code: 'unsupported_effect' }, // game/room.go:664
];

function matchErrorText<C extends string>(
  rules: readonly ErrorTextRule<C>[],
  message: string,
): { code: C; groups: Record<string, string> } | null {
  for (const rule of rules) {
    const m = rule.pattern.exec(message);
    if (m !== null) return { code: rule.code, groups: rule.details === true ? { ...m.groups } : {} };
  }
  return null;
}

function interpretWsError(ctx: Ctx, payload: unknown): ProtocolErrorInfo {
  const empty: ProtocolErrorInfo = { code: null, square: null, needed: null, available: null };
  // P1-3 (contratto `proposed`): un codice esplicito prevale sul testo.
  if (isRecord(payload) && typeof payload['code'] === 'string') {
    if (isOneOf(PROTOCOL_ERROR_CODES, payload['code'])) return { ...empty, code: payload['code'] };
    warn(ctx, 'error_code_unknown', payload['code']);
  }
  const message = isRecord(payload) && typeof payload['message'] === 'string' ? payload['message'] : null;
  const matched = message === null ? null : matchErrorText(WS_ERROR_TEXTS, message);
  if (matched === null) {
    warn(ctx, 'error_text_unknown', message === null ? typeof payload : 'testo non riconosciuto');
    return empty;
  }
  const square = matched.groups['square'];
  const needed = matched.groups['needed'];
  const available = matched.groups['available'];
  return {
    code: matched.code,
    square: isSquare(square) ? square : null,
    needed: needed === undefined ? null : Number(needed),
    available: available === undefined ? null : Number(available),
  };
}

// ===================================================================================================
// §4 Encoder WebSocket in uscita (`game/room.go:268-310`)
// ===================================================================================================

type WireClientMessage =
  | { readonly type: 'move'; readonly payload: { readonly move: string } }
  | {
      readonly type: 'resign' | 'draw_offer' | 'draw_accepted' | 'draw_declined' | 'pass_phase';
      readonly payload: Record<string, never>;
    }
  | { readonly type: 'cast_spell'; readonly payload: { readonly spell_id: string; readonly targets: readonly string[] } };

export function encodeClientIntent(intent: ClientIntent): string {
  let message: WireClientMessage;
  switch (intent.type) {
    case 'move':
      message = { type: 'move', payload: { move: intent.move } };
      break;
    case 'cast_spell':
      // Il server identifica la carta per spell_id (`match/match.go:318`): l'id locale non viaggia.
      message = { type: 'cast_spell', payload: { spell_id: intent.card.spellId, targets: [...intent.targets] } };
      break;
    case 'resign':
    case 'draw_offer':
    case 'draw_accepted':
    case 'draw_declined':
    case 'pass_phase':
      message = { type: intent.type, payload: {} };
      break;
    default:
      return assertNever(intent);
  }
  return JSON.stringify(message);
}

// ===================================================================================================
// §5 REST
// ===================================================================================================

/** Esito di una normalizzazione REST. */
export type Normalized<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly AdapterWarning[] }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Testi esatti degli errori REST. */
export const HTTP_ERROR_TEXTS: readonly ErrorTextRule<HttpErrorCode>[] = [
  { pattern: /^Dati non validi$/, code: 'invalid_request' }, // handlers/auth.go:27,98,197
  { pattern: /^Username, email e password sono obbligatori$/, code: 'missing_fields' }, // handlers/auth.go:37
  { pattern: /^username deve avere almeno 3 caratteri$/, code: 'username_too_short' }, // validation/validation.go:15
  { pattern: /^username non può superare 20 caratteri$/, code: 'username_too_long' }, // validation/validation.go:18
  { pattern: /^username può contenere solo lettere, numeri e underscore$/, code: 'username_invalid_chars' }, // validation/validation.go:21
  { pattern: /^email non valida$/, code: 'email_invalid' }, // validation/validation.go:26
  { pattern: /^password deve avere almeno 8 caratteri$/, code: 'password_too_short' }, // validation/validation.go:39
  { pattern: /^password non può superare 72 caratteri$/, code: 'password_too_long' }, // validation/validation.go:43
  { pattern: /^password deve contenere almeno una lettera maiuscola$/, code: 'password_needs_uppercase' }, // validation/validation.go:59
  { pattern: /^password deve contenere almeno una lettera minuscola$/, code: 'password_needs_lowercase' }, // validation/validation.go:62
  { pattern: /^password deve contenere almeno un numero$/, code: 'password_needs_digit' }, // validation/validation.go:65
  { pattern: /^Username o email già in uso$/, code: 'username_or_email_taken' }, // handlers/auth.go:78
  { pattern: /^Credenziali non valide$/, code: 'invalid_credentials' }, // handlers/auth.go:116,126
  { pattern: /^Refresh token non valido o scaduto$/, code: 'refresh_token_invalid' }, // handlers/auth.go:210
  { pattern: /^Token non valido o scaduto$/, code: 'token_invalid_or_expired' }, // middleware/auth.go:52
  { pattern: /^Token non valido$/, code: 'token_invalid' }, // handlers/auth.go:222
  { pattern: /^Token mancante$/, code: 'token_missing' }, // middleware/auth.go:38
  { pattern: /^Utente non trovato$/, code: 'user_not_found' }, // handlers/auth.go:236; handlers/stats.go:134
  { pattern: /^Troppe richieste, rallenta!$/, code: 'rate_limited' }, // middleware/ratelimit.go:85
  { pattern: /^ID non valido$/, code: 'invalid_id' }, // handlers/stats.go:60,119
  { pattern: /^(Errore interno|Errore generazione token|Errore recupero profilo|Errore DB)$/, code: 'internal_error' }, // handlers/auth.go:59,137,288; handlers/stats.go:25,82
];

export type HttpOutcome =
  | { readonly ok: true; readonly data: unknown; readonly warnings: readonly AdapterWarning[] }
  | { readonly ok: false; readonly error: HttpErrorInfo; readonly warnings: readonly AdapterWarning[] };

/**
 * Interpreta una risposta HTTP a partire dal corpo testuale. L'inviluppo è `{success, data?, error?}`
 * (`models/response.go:5-9`); le rotte inesistenti rispondono in testo semplice (B12).
 */
export function interpretHttpResponse(status: number, rawBody: string): HttpOutcome {
  const ctx = createCtx();
  let body: unknown;
  try {
    body = rawBody === '' ? null : JSON.parse(rawBody);
  } catch {
    body = undefined;
  }
  const envelope = isRecord(body) ? body : null;
  if (envelope !== null && envelope['success'] === true && status >= 200 && status < 300) {
    return { ok: true, data: envelope['data'] ?? null, warnings: ctx.warnings };
  }

  const text = envelope !== null && typeof envelope['error'] === 'string' ? envelope['error'] : null;
  const matched = text === null ? null : matchErrorText(HTTP_ERROR_TEXTS, text);
  let code: HttpErrorCode | null = matched?.code ?? null;
  if (code === null) {
    if (status === 404) code = 'not_found';
    else if (status === 503) code = 'service_unavailable'; // handlers/status.go:16: nessun testo d'errore
    else if (status === 429) code = 'rate_limited';
    else warn(ctx, 'http_error_text_unknown', `status ${status}`);
  }
  return { ok: false, error: { status, code }, warnings: ctx.warnings };
}

function normalize<S extends z.ZodType, T>(schema: S, data: unknown, build: (value: z.output<S>) => T): Normalized<T> {
  const parsed = parseWith(schema, data);
  return parsed.ok ? { ok: true, value: build(parsed.data), warnings: [] } : { ok: false, issues: parsed.issues };
}

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? null : value));

const wireAccountSchema = z.object({
  id: wireId,
  username: nonEmptyString,
  email: z.string(),
  elo: z.number(),
  created_at: optionalText,
});

function toAccount(user: z.output<typeof wireAccountSchema>): UserAccount {
  return { id: user.id, username: user.username, email: user.email, elo: user.elo, createdAt: user.created_at };
}

const wireTokenPairSchema = z.object({ access_token: nonEmptyString, refresh_token: nonEmptyString });

function toTokenPair(tokens: z.output<typeof wireTokenPairSchema>): TokenPair {
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

/** `POST /auth/register` → `{user_id}` (`handlers/auth.go:83-86`). */
export function normalizeRegistration(data: unknown): Normalized<Registration> {
  return normalize(z.object({ user_id: wireId }), data, (d) => ({ userId: d.user_id }));
}

/** `POST /auth/login` (`handlers/auth.go:149-158`). */
export function normalizeLogin(data: unknown): Normalized<AuthSession> {
  return normalize(z.object({ tokens: wireTokenPairSchema, user: wireAccountSchema }), data, (d) => ({
    tokens: toTokenPair(d.tokens),
    user: toAccount(d.user),
  }));
}

/** `POST /auth/refresh`: i token stanno direttamente in `data` (`handlers/auth.go:262-268`). */
export function normalizeTokenPair(data: unknown): Normalized<TokenPair> {
  return normalize(wireTokenPairSchema, data, toTokenPair);
}

/** `GET /me` (`handlers/auth.go:272-296`). */
export function normalizeAccount(data: unknown): Normalized<UserAccount> {
  return normalize(wireAccountSchema, data, toAccount);
}

/** `GET /users/{id}` (`handlers/stats.go:150-161`). */
export function normalizePublicProfile(data: unknown): Normalized<PublicProfile> {
  const schema = z.object({
    user: z.object({ id: wireId, username: nonEmptyString, elo: z.number(), created_at: optionalText }),
    stats: z.object({ wins: count, losses: count, draws: count, total: count }),
  });
  return normalize(schema, data, (d) => ({
    user: { id: d.user.id, username: d.user.username, elo: d.user.elo, createdAt: d.user.created_at },
    stats: d.stats,
  }));
}

/** `GET /leaderboard` (`handlers/stats.go:30-50`): `data` può essere `null` (B8). */
export function normalizeLeaderboard(data: unknown): Normalized<readonly LeaderboardEntry[]> {
  const entry = z.object({ rank: count, id: wireId, username: nonEmptyString, elo: z.number() });
  return normalize(nullableList(entry), data, (list) => list);
}

/** `GET /users/{id}/games` (`handlers/stats.go:87-107`): `data` può essere `null` (B8). */
export function normalizeGameHistory(data: unknown): Normalized<readonly GameHistoryEntry[]> {
  const entry = z.object({
    id: wireId,
    white: z.string(),
    black: z.string(),
    result: z.string(),
    time_control: z.string(),
    pgn: z.string(),
    played_at: z.string(),
  });
  const ctx = createCtx();
  const parsed = parseWith(nullableList(entry), data);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const value = parsed.data.map((g) => ({
    id: g.id,
    white: g.white,
    black: g.black,
    result: readEnum(ctx, g.result, GAME_RESULTS, 'result'),
    timeControl: g.time_control,
    pgn: g.pgn,
    playedAt: g.played_at,
  }));
  return { ok: true, value, warnings: ctx.warnings };
}

/** `GET /status` (`handlers/status.go`): risponde con `data` anche in 503. Il corpo va passato grezzo. */
export function normalizeStatus(status: number, rawBody: string): ServerStatus {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { healthy: false, version: null };
  }
  const data = isRecord(body) && isRecord(body['data']) ? body['data'] : {};
  return {
    healthy: status === 200 && data['status'] === 'ok',
    version: typeof data['version'] === 'string' ? data['version'] : null,
  };
}

export function encodeRegister(username: string, email: string, password: string): string {
  return JSON.stringify({ username, email, password });
}

export function encodeLogin(email: string, password: string): string {
  return JSON.stringify({ email, password });
}

export function encodeRefresh(refreshToken: string): string {
  return JSON.stringify({ refresh_token: refreshToken });
}

/**
 * Requisiti delle credenziali, copiati da `validation/validation.go`. Servono solo a mostrarli prima del
 * submit (briefing §7.1); l'autorità resta il server. Le lunghezze della password sono in **byte**
 * (`len()` in Go), la lunghezza dello username dopo il trim.
 */
export const CREDENTIAL_POLICY = {
  username: { minLength: 3, maxLength: 20, pattern: /^[a-zA-Z0-9_]+$/ },
  email: { pattern: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/ },
  password: { minBytes: 8, maxBytes: 72, requireUppercase: true, requireLowercase: true, requireDigit: true },
} as const;

// ===================================================================================================
// §7 Catalogo magie (G10, C3)
// ===================================================================================================

const wireSpellSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  mana_cost: z.number(),
  phases: z.array(z.string()),
  target_type: z.string(),
  effects: z.array(z.object({ kind: z.string(), params: z.record(z.string(), z.unknown()).nullable().optional() })),
});

export interface NormalizedCatalog {
  readonly spells: readonly Spell[];
  readonly warnings: readonly AdapterWarning[];
}

/** Accetta un array di magie o `{ spells: [...] }`. Le voci invalide vengono scartate una per una. */
export function normalizeSpellCatalog(raw: unknown): NormalizedCatalog {
  const ctx = createCtx();
  const list: unknown = isRecord(raw) && Array.isArray(raw['spells']) ? raw['spells'] : raw;
  if (!Array.isArray(list)) {
    warn(ctx, 'catalog_shape_unexpected', typeof raw);
    return { spells: [], warnings: ctx.warnings };
  }

  const spells: Spell[] = [];
  list.forEach((entry: unknown, index) => {
    const wire = parseWith(wireSpellSchema, entry);
    if (!wire.ok) {
      warn(ctx, 'catalog_entry_invalid', `[${index}] ${wire.issues.join('; ')}`);
      return;
    }
    const internal = parseWith(spellSchema, {
      id: wire.data.id,
      name: wire.data.name,
      manaCost: wire.data.mana_cost,
      phases: wire.data.phases,
      targetType: wire.data.target_type,
      effects: wire.data.effects.map((effect) => ({ kind: effect.kind, params: effect.params ?? {} })),
    });
    if (!internal.ok) {
      warn(ctx, 'catalog_entry_invalid', `${wire.data.id}: ${internal.issues.join('; ')}`);
      return;
    }
    spells.push(internal.data);
  });
  return { spells, warnings: ctx.warnings };
}
