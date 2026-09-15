/**
 * Adapter: l'UNICO punto del client che interpreta i payload grezzi del server.
 *
 * Ogni assunzione sul server Go (docs/ASSUMPTIONS.md) vive in questo file. Quando il server reale ne
 * smentisce una, si corregge qui e basta. Se ti accorgi di stare normalizzando un payload altrove, fermati.
 *
 * Sezioni:
 *   §1 Registro assunzioni e warning
 *   §2 Letture tolleranti del filo (schemi zod e helper privati)
 *   §3 Decoder WebSocket in entrata         G1 G2 G4 G5 G6 G8 A13 A14 A15
 *   §4 Encoder WebSocket in uscita          G2 G3
 *   §5 REST: auth e profili                 A11 A12
 *   §6 Ticket WebSocket                     P0-1 / A12
 *   §7 Catalogo magie                       G10
 *
 * Regole: non lancia mai eccezioni su input del server, un campo sconosciuto viene ignorato, e il testo
 * libero del server non esce mai da qui.
 */

import { z } from 'zod';

import {
  BOARD_STATUSES,
  GAME_OVER_REASONS,
  GAME_RESULTS,
  PHASES,
  type ActiveEffect,
  type AppliedEffect,
  type Clocks,
  type Color,
  type HandCard,
  type ManaState,
  type MatchSnapshot,
  type PieceKind,
  type PieceState,
  type ProtocolErrorInfo,
  type Square,
  type TimeControl,
  type Username,
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
import type { AuthSession, HttpErrorInfo, UserProfile, UserSummary, WsTicket } from './types';

// ===================================================================================================
// §1 Registro assunzioni e warning
// ===================================================================================================

export type AssumptionId =
  | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10'
  | 'A11' | 'A12' | 'A13' | 'A14' | 'A15' | 'A16' | 'A17' | 'A18' | 'A19';

/** Ogni warning è legato all'assunzione che l'ha generato, così un log porta a ASSUMPTIONS.md. */
const WARNING_ASSUMPTION = {
  pieces_missing: 'G1',
  pieces_malformed: 'G1',
  card_spell_id_missing: 'G2',
  snapshot_incomplete: 'G4',
  error_unstructured: 'G6',
  effect_malformed: 'G8',
  catalog_shape_unexpected: 'G10',
  catalog_entry_invalid: 'G10',
  user_stats_missing: 'A12',
  deck_size_missing: 'A14',
  enum_unknown: 'A15',
  number_out_of_range: 'A15',
  field_missing: 'A15',
  value_invalid: 'A15',
} as const satisfies Record<string, AssumptionId>;

export type AdapterWarningCode = keyof typeof WARNING_ASSUMPTION;

export interface AdapterWarning {
  readonly code: AdapterWarningCode;
  readonly assumption: AssumptionId;
  readonly detail?: string;
}

/** Esito di una normalizzazione REST. */
export type Normalized<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly AdapterWarning[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface DecodeOptions {
  /** Generatore di id d'istanza locali per le carte senza `spell_id` (G2). Iniettabile nei test. */
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
/** Campo letto dopo con regole proprie (enum aperti, orologi, pezzi): lo schema del nucleo non lo vincola. */
const loose = z.unknown().optional();
const wireUserId = z.union([z.string().min(1), z.number()]).transform((id) => String(id));

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

const squareSchema = z.custom<Square>(isSquare, 'casella non valida');

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

const COLORS: readonly Color[] = ['white', 'black'];

// G1: lettera chess.js (`p`…`k`) oppure nome esteso, senza distinzione maiuscole/minuscole.
const PIECE_TOKENS = ['p', 'n', 'b', 'r', 'q', 'k', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;
const PIECE_KIND_BY_TOKEN: Readonly<Record<(typeof PIECE_TOKENS)[number], PieceKind>> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
  pawn: 'pawn', knight: 'knight', bishop: 'bishop', rook: 'rook', queen: 'queen', king: 'king',
};
const pieceKindSchema = z
  .string()
  .transform((token) => token.toLowerCase())
  .pipe(z.enum(PIECE_TOKENS))
  .transform((token) => PIECE_KIND_BY_TOKEN[token]);

// --- Pezzi (G1) ------------------------------------------------------------------------------------

const wirePieceSchema = z.object({
  piece_id: nonEmptyString,
  square: squareSchema,
  type: pieceKindSchema,
  color: z.enum(['white', 'black']),
  effects: z
    .array(z.object({ kind: nonEmptyString, remaining_turns: z.number().nullable().optional() }))
    .optional(),
});

function decodePieces(ctx: Ctx, raw: unknown): PieceState[] | null {
  if (raw === undefined || raw === null) {
    warn(ctx, 'pieces_missing');
    return null;
  }
  const parsed = parseWith(z.array(wirePieceSchema), raw);
  if (!parsed.ok) {
    // Una lista parziale disegnerebbe badge sbagliati: meglio nessun mapping (G1).
    warn(ctx, 'pieces_malformed', parsed.issues.slice(0, 3).join('; '));
    return null;
  }
  return parsed.data.map((piece) => ({
    pieceId: piece.piece_id,
    square: piece.square,
    kind: piece.type,
    color: piece.color,
    effects: (piece.effects ?? []).map((effect) => ({
      kind: effect.kind,
      remainingTurns:
        effect.remaining_turns === undefined || effect.remaining_turns === null
          ? null
          : clampNonNegative(ctx, effect.remaining_turns, 'remaining_turns'),
    })),
  }));
}

// --- Carte (G2) ------------------------------------------------------------------------------------

const wireHandCardSchema = z.object({ card_id: nonEmptyString, spell_id: nonEmptyString.optional() });

function toHandCard(ctx: Ctx, card: z.output<typeof wireHandCardSchema>): HandCard {
  if (card.spell_id !== undefined) {
    return { instanceId: card.card_id, spellId: card.spell_id, instanceIdIsLocal: false };
  }
  warn(ctx, 'card_spell_id_missing', `card_id=${card.card_id}`);
  return { instanceId: ctx.newLocalId(), spellId: card.card_id, instanceIdIsLocal: true };
}

// --- Effetti applicati (G8) ------------------------------------------------------------------------

const wireAppliedEffectSchema = z.object({
  kind: nonEmptyString,
  piece_id: nonEmptyString.nullable().optional(),
  square: squareSchema.nullable().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function decodeAppliedEffects(ctx: Ctx, raw: unknown): AppliedEffect[] {
  if (!Array.isArray(raw)) {
    warn(ctx, 'effect_malformed', 'effects_applied non è un array');
    return [];
  }
  const effects: AppliedEffect[] = [];
  raw.forEach((item: unknown, index) => {
    const parsed = parseWith(wireAppliedEffectSchema, item);
    if (!parsed.ok) {
      warn(ctx, 'effect_malformed', `effects_applied[${index}]: ${parsed.issues.join('; ')}`);
      return;
    }
    effects.push({
      kind: parsed.data.kind,
      pieceId: parsed.data.piece_id ?? null,
      square: parsed.data.square ?? null,
      params: parsed.data.params ?? {},
    });
  });
  return effects;
}

// --- Orologi ---------------------------------------------------------------------------------------

function readClocks(ctx: Ctx, white: unknown, black: unknown): Clocks | null {
  if (typeof white !== 'number' || typeof black !== 'number') {
    warn(ctx, 'field_missing', 'white_time/black_time');
    return null;
  }
  return { white: clampNonNegative(ctx, white, 'white_time'), black: clampNonNegative(ctx, black, 'black_time') };
}

// ===================================================================================================
// §3 Decoder WebSocket in entrata
// ===================================================================================================

type DecoderOutput<K extends ServerMessageType> =
  | { readonly ok: true; readonly event: ServerEventOf<K> }
  | { readonly ok: false; readonly issues: string[] };

type Decoder<K extends ServerMessageType> = (payload: unknown, ctx: Ctx) => DecoderOutput<K>;

/** Esegue lo schema del nucleo documentato e, se valido, costruisce l'evento. */
function withCore<S extends z.ZodType, K extends ServerMessageType>(
  schema: S,
  payload: unknown,
  build: (data: z.output<S>) => ServerEventOf<K>,
): DecoderOutput<K> {
  const parsed = parseWith(schema, payload);
  return parsed.ok ? { ok: true, event: build(parsed.data) } : { ok: false, issues: parsed.issues };
}

// G4 + G5: nucleo documentato, estensioni assunte lette una per una.
const gameStartCoreSchema = z.object({
  room_id: nonEmptyString,
  white: nonEmptyString,
  black: nonEmptyString,
  fen: nonEmptyString,
});

const usernameNumberMap = z.record(z.string(), z.number().int().min(0));
const usernameManaMap = z.record(z.string(), z.object({ current: z.number().min(0), max: z.number().min(0) }));
const timeControlSchema = z.object({ initial_ms: z.number().min(0), increment_ms: z.number().min(0) });

const decodeGameStart: Decoder<'game_start'> = (payload, ctx) =>
  withCore(gameStartCoreSchema, payload, (core) => {
    const extra = isRecord(payload) ? payload : {};
    const incomplete: string[] = [];

    function optional<S extends z.ZodType>(field: string, schema: S): z.output<S> | null {
      const value = extra[field];
      if (value === undefined || value === null) {
        incomplete.push(field);
        return null;
      }
      const parsed = parseWith(schema, value);
      if (!parsed.ok) {
        incomplete.push(`${field} (malformato)`);
        return null;
      }
      return parsed.data;
    }

    const moves = optional('moves', z.array(z.string()));
    const whiteTime = optional('white_time', z.number());
    const blackTime = optional('black_time', z.number());
    const timeControl = optional('time_control', timeControlSchema);
    const phaseRaw = optional('phase', z.string());
    const activePlayer = optional('active_player', nonEmptyString);
    const turnNumber = optional('turn_number', z.number().int().min(0));
    const handRaw = optional('hand', z.array(wireHandCardSchema));
    const handSizes = optional('hand_sizes', usernameNumberMap);
    const deckSizes = optional('deck_sizes', usernameNumberMap);
    const mana = optional('mana', usernameManaMap);

    const clocks: Clocks | null =
      whiteTime !== null && blackTime !== null
        ? { white: clampNonNegative(ctx, whiteTime, 'white_time'), black: clampNonNegative(ctx, blackTime, 'black_time') }
        : null;
    const tc: TimeControl | null =
      timeControl === null ? null : { initialMs: timeControl.initial_ms, incrementMs: timeControl.increment_ms };
    const manaMap: Record<Username, ManaState> | null = mana;

    const snapshot: MatchSnapshot = {
      roomId: core.room_id,
      players: { white: core.white, black: core.black },
      fen: core.fen,
      moves: moves ?? [],
      clocks,
      timeControl: tc,
      pieces: decodePieces(ctx, extra['pieces']),
      phase: phaseRaw === null ? null : readEnum(ctx, phaseRaw, PHASES, 'phase'),
      activePlayer,
      turnNumber,
      hand: handRaw === null ? null : handRaw.map((card) => toHandCard(ctx, card)),
      handSizes,
      deckSizes,
      mana: manaMap,
    };

    if (incomplete.length > 0) warn(ctx, 'snapshot_incomplete', incomplete.join(', '));
    return { type: 'game_start', snapshot };
  });

const gameStateCoreSchema = z.object({
  board: z.object({
    fen: nonEmptyString,
    moves: z.array(z.string()),
    turn: loose,
    status: loose,
  }),
  white_time: loose,
  black_time: loose,
  pieces: loose,
});

const decodeGameState: Decoder<'game_state'> = (payload, ctx) =>
  withCore(gameStateCoreSchema, payload, (core) => ({
    type: 'game_state',
    fen: core.board.fen,
    moves: core.board.moves,
    turn: readEnum(ctx, core.board.turn, COLORS, 'board.turn'),
    status: readEnum(ctx, core.board.status, BOARD_STATUSES, 'board.status'),
    clocks: readClocks(ctx, core.white_time, core.black_time),
    pieces: decodePieces(ctx, core.pieces),
  }));

const decodeTimerUpdate: Decoder<'timer_update'> = (payload, ctx) =>
  withCore(z.object({ white_time: z.number(), black_time: z.number(), turn: loose }), payload, (core) => ({
    type: 'timer_update',
    clocks: {
      white: clampNonNegative(ctx, core.white_time, 'white_time'),
      black: clampNonNegative(ctx, core.black_time, 'black_time'),
    },
    turn: readEnum(ctx, core.turn, COLORS, 'turn'),
  }));

const decodeGameOver: Decoder<'game_over'> = (payload, ctx) =>
  withCore(z.object({ result: loose, reason: loose, winner: loose }), payload, (core) => ({
    type: 'game_over',
    result: readEnum(ctx, core.result, GAME_RESULTS, 'result'),
    reason: readEnum(ctx, core.reason, GAME_OVER_REASONS, 'reason'),
    winner: typeof core.winner === 'string' && core.winner.length > 0 ? core.winner : null,
  }));

const decodeDrawOffer: Decoder<'draw_offer'> = (payload) =>
  withCore(z.object({ from: nonEmptyString }), payload, (core) => ({ type: 'draw_offer', from: core.from }));

// Il payload (testo in italiano) viene ignorato di proposito: la UI usa le proprie stringhe.
const decodeOpponentDisconnected: Decoder<'opponent_disconnected'> = () => ({
  ok: true,
  event: { type: 'opponent_disconnected' },
});

// G6: `error` non fallisce mai, qualunque sia il payload.
const decodeError: Decoder<'error'> = (payload, ctx) => {
  let info: ProtocolErrorInfo = { code: null };
  if (isRecord(payload) && typeof payload['code'] === 'string' && payload['code'].length > 0) {
    info = { code: payload['code'] };
  } else {
    warn(ctx, 'error_unstructured', typeof payload);
  }
  return { ok: true, event: { type: 'error', error: info } };
};

const decodePhaseChanged: Decoder<'phase_changed'> = (payload, ctx) =>
  withCore(
    z.object({ phase: loose, active_player: nonEmptyString, turn_number: z.number().int() }),
    payload,
    (core) => ({
      type: 'phase_changed',
      phase: readEnum(ctx, core.phase, PHASES, 'phase'),
      activePlayer: core.active_player,
      turnNumber: clampNonNegative(ctx, core.turn_number, 'turn_number'), // A13: nessuna trasformazione
    }),
  );

const decodeCardDrawn: Decoder<'card_drawn'> = (payload, ctx) =>
  withCore(wireHandCardSchema, payload, (card) => ({ type: 'card_drawn', card: toHandCard(ctx, card) }));

const decodeHandSizeChanged: Decoder<'hand_size_changed'> = (payload, ctx) =>
  withCore(
    z.object({ player: nonEmptyString, size: z.number().int(), deck_size: z.number().int().optional() }),
    payload,
    (core) => {
      if (core.deck_size === undefined) warn(ctx, 'deck_size_missing');
      return {
        type: 'hand_size_changed',
        player: core.player,
        size: clampNonNegative(ctx, core.size, 'size'),
        deckSize: core.deck_size === undefined ? null : clampNonNegative(ctx, core.deck_size, 'deck_size'),
      };
    },
  );

const decodeManaChanged: Decoder<'mana_changed'> = (payload, ctx) =>
  withCore(z.object({ player: nonEmptyString, current: z.number(), max: z.number() }), payload, (core) => ({
    type: 'mana_changed',
    player: core.player,
    mana: { current: clampNonNegative(ctx, core.current, 'current'), max: clampNonNegative(ctx, core.max, 'max') },
  }));

const decodeSpellCast: Decoder<'spell_cast'> = (payload, ctx) =>
  withCore(
    z.object({ player: nonEmptyString, spell_id: nonEmptyString, targets: z.array(z.unknown()), effects_applied: loose }),
    payload,
    (core) => {
      const targets = core.targets.filter(isSquare);
      if (targets.length !== core.targets.length) warn(ctx, 'value_invalid', 'spell_cast.targets');
      return {
        type: 'spell_cast',
        player: core.player,
        spellId: core.spell_id,
        targets,
        effects: decodeAppliedEffects(ctx, core.effects_applied),
      };
    },
  );

const decodeEffectApplied: Decoder<'effect_applied'> = (payload, ctx) =>
  withCore(
    z.object({ piece_id: nonEmptyString, effect_kind: nonEmptyString, remaining_turns: z.number().nullable().optional() }),
    payload,
    (core) => {
      const effect: ActiveEffect = {
        kind: core.effect_kind,
        remainingTurns:
          core.remaining_turns === undefined || core.remaining_turns === null
            ? null
            : clampNonNegative(ctx, core.remaining_turns, 'remaining_turns'),
      };
      return { type: 'effect_applied', pieceId: core.piece_id, effect };
    },
  );

const decodeEffectExpired: Decoder<'effect_expired'> = (payload) =>
  withCore(z.object({ piece_id: nonEmptyString, effect_kind: nonEmptyString }), payload, (core) => ({
    type: 'effect_expired',
    pieceId: core.piece_id,
    effectKind: core.effect_kind,
  }));

/** Un type aggiunto a SERVER_MESSAGE_TYPES senza decoder qui è un errore di compilazione. */
const DECODERS: { readonly [K in ServerMessageType]: Decoder<K> } = {
  game_start: decodeGameStart,
  game_state: decodeGameState,
  timer_update: decodeTimerUpdate,
  game_over: decodeGameOver,
  draw_offer: decodeDrawOffer,
  opponent_disconnected: decodeOpponentDisconnected,
  error: decodeError,
  phase_changed: decodePhaseChanged,
  card_drawn: decodeCardDrawn,
  hand_size_changed: decodeHandSizeChanged,
  mana_changed: decodeManaChanged,
  spell_cast: decodeSpellCast,
  effect_applied: decodeEffectApplied,
  effect_expired: decodeEffectExpired,
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
// §4 Encoder WebSocket in uscita
// ===================================================================================================

type WireClientMessage =
  | { readonly type: 'move'; readonly payload: { readonly move: string } }
  | { readonly type: 'resign' | 'draw_offer' | 'draw_accepted' | 'draw_declined' | 'pass_phase'; readonly payload: Record<string, never> }
  // G2: `card_id` NON viene inviato finché il server non lo accetta (P0-4). G3: caselle in ordine semantico.
  | { readonly type: 'cast_spell'; readonly payload: { readonly spell_id: string; readonly targets: readonly string[] } };

export function encodeClientIntent(intent: ClientIntent): string {
  let message: WireClientMessage;
  switch (intent.type) {
    case 'move':
      message = { type: 'move', payload: { move: intent.move } };
      break;
    case 'cast_spell':
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
// §5 REST: auth e profili (A11, A12)
// ===================================================================================================

/** Requisiti assunti per le credenziali (A11). Unica copia nel client, finché P1-4 non li espone. */
export const CREDENTIAL_POLICY = {
  username: { minLength: 3, maxLength: 20, pattern: /^[A-Za-z0-9_]+$/ },
  password: { minLength: 8, maxLength: 72 },
} as const;

const wireUserSummarySchema = z.object({ id: wireUserId, username: nonEmptyString, elo: z.number() });

function toUserSummary(user: z.output<typeof wireUserSummarySchema>): UserSummary {
  return { id: user.id, username: user.username, elo: user.elo };
}

export function normalizeUserSummary(raw: unknown): Normalized<UserSummary> {
  const parsed = parseWith(wireUserSummarySchema, raw);
  return parsed.ok ? { ok: true, value: toUserSummary(parsed.data), warnings: [] } : { ok: false, issues: parsed.issues };
}

const wireStatsSchema = z.object({
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  draws: z.number().int().min(0),
});

/** `GET /me` e `GET /users/{id}`. */
export function normalizeUserProfile(raw: unknown): Normalized<UserProfile> {
  const parsed = parseWith(wireUserSummarySchema, raw);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const ctx = createCtx();
  const stats = parseWith(wireStatsSchema, raw);
  if (!stats.ok) warn(ctx, 'user_stats_missing');
  return {
    ok: true,
    value: { ...toUserSummary(parsed.data), stats: stats.ok ? stats.data : null },
    warnings: ctx.warnings,
  };
}

/** `POST /auth/login`. */
export function normalizeLoginResponse(raw: unknown): Normalized<AuthSession> {
  const parsed = parseWith(z.object({ token: nonEmptyString, user: wireUserSummarySchema }), raw);
  return parsed.ok
    ? { ok: true, value: { token: parsed.data.token, user: toUserSummary(parsed.data.user) }, warnings: [] }
    : { ok: false, issues: parsed.issues };
}

/** Qualunque risposta HTTP non 2xx. Il testo libero del server non viene conservato. */
export function normalizeHttpError(status: number, body: unknown): HttpErrorInfo {
  if (isRecord(body) && typeof body['error'] === 'string' && body['error'].length > 0) {
    return { status, code: body['error'] };
  }
  if (isRecord(body) && typeof body['code'] === 'string' && body['code'].length > 0) {
    return { status, code: body['code'] };
  }
  return { status, code: null };
}

/** Body di `POST /auth/register` e `POST /auth/login` (A11). */
export function encodeCredentials(username: string, password: string): string {
  return JSON.stringify({ username, password });
}

// ===================================================================================================
// §6 Ticket WebSocket (P0-1, A12)
// ===================================================================================================

export function normalizeWsTicket(raw: unknown): Normalized<WsTicket> {
  const parsed = parseWith(z.object({ ticket: nonEmptyString, expires_in: z.number().min(0).optional() }), raw);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const ctx = createCtx();
  if (parsed.data.expires_in === undefined) warn(ctx, 'field_missing', 'expires_in');
  return {
    ok: true,
    value: {
      ticket: parsed.data.ticket,
      expiresInMs: parsed.data.expires_in === undefined ? null : parsed.data.expires_in * 1000,
    },
    warnings: ctx.warnings,
  };
}

// ===================================================================================================
// §7 Catalogo magie (G10)
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
