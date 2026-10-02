/**
 * Adapter: l'UNICO punto del client che interpreta i payload grezzi del server.
 *
 * Fonte del contratto: il codice di chess-server (`internal/`, branch `fix/backend-requests`), citato come
 * `file.go:riga`.
 * Ciò che il codice non determina è in docs/ASSUMPTIONS.md: quelle voci vivono qui e generano warning
 * etichettati con il loro id. Se ti accorgi di stare normalizzando un payload altrove, fermati.
 *
 * Sezioni:
 *   §1 Registro assunzioni e warning
 *   §2 Letture tolleranti del filo
 *   §3 Decoder WebSocket in entrata
 *   §3b Errori WebSocket: codici e dettagli
 *   §4 Encoder WebSocket in uscita
 *   §5 REST: inviluppo, testi d'errore, normalizzatori, encoder
 *   §6 Policy delle credenziali
 *   §7 Catalogo magie
 *
 * Regole: non lancia mai eccezioni su input del server, un campo sconosciuto viene ignorato, e il testo
 * libero del server non esce mai da qui.
 */

import { z } from 'zod';

import {
  BOARD_STATUSES,
  BOT_LEVELS,
  COLORS,
  GAME_OVER_REASONS,
  GAME_RESULTS,
  PHASES,
  PERMANENT_TURNS,
  PIECE_KINDS,
  PROTOCOL_ERROR_CODES,
  type ActiveEffect,
  type AppliedEffect,
  type BotIdentity,
  type ExpiredEffect,
  type HandCard,
  type MatchPlayers,
  type PerColor,
  type MoveOptions,
  type PieceKind,
  type PlayedMove,
  type PlayerAura,
  type PlayerEffects,
  type PlayerTrigger,
  type ProtocolErrorCode,
  type ProtocolErrorInfo,
  type RuneResult,
  type Square,
  type SquareEffects,
  type TimeControl,
  type TriggerResult,
} from '../game/model';
import { spellSchema, type Spell } from '../spells/schema';
import {
  assertNever,
  DRAW_DECLINE_REASONS,
  isServerMessageType,
  type ClientIntent,
  type DecodeResult,
  type ServerEventOf,
  type ServerMessageType,
} from '../ws/protocol';
import {
  FRIEND_STATUSES,
  RELATIONS,
  type BlockedUser,
  type AuthSession,
  type CardCollection,
  type Challenge,
  type CollectionCard,
  type Deck,
  type DeckList,
  type CredentialPolicy,
  type Friend,
  type FriendList,
  type GameHistoryEntry,
  type HttpErrorCode,
  type HttpErrorInfo,
  type LeaderboardEntry,
  type PresenceUpdate,
  type UserSearchResult,
  type PublicProfile,
  type Registration,
  type ServerStatus,
  type TokenPair,
  type UserAccount,
  type WsTicket,
} from './types';

// ===================================================================================================
// §1 Registro assunzioni e warning
// ===================================================================================================

export type AssumptionId = 'G1' | 'G6' | 'G8' | 'G10' | 'A15' | 'C1' | 'C4' | 'C9';

/** Ogni warning è legato all'assunzione che l'ha generato, così un log porta a ASSUMPTIONS.md. */
const WARNING_ASSUMPTION = {
  active_effect_malformed: 'G1',
  error_code_missing: 'G6',
  error_code_unknown: 'G6',
  effect_unknown: 'G8',
  catalog_shape_unexpected: 'G10',
  catalog_entry_invalid: 'G10',
  collection_entry_invalid: 'G10',
  deck_entry_invalid: 'G10',
  friend_entry_invalid: 'G10',
  search_entry_invalid: 'G10',
  challenge_entry_invalid: 'G10',
  enum_unknown: 'A15',
  number_out_of_range: 'A15',
  value_invalid: 'A15',
  players_missing: 'C1',
  http_error_text_unknown: 'C4',
  password_policy_invalid: 'C9',
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
/** Liste: il server ora manda `[]` (B8 risolto), `null` e assenza restano tollerati come lista vuota. */
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

// --- Effetti persistenti per casella (`effects/tracker.go:262-292`) ------------------------------

const wireActiveEffectSchema = z.object({
  kind: nonEmptyString,
  remaining_turns: count,
  source_spell_id: z.string().optional(),
  caster: loose,
  // Solo per le rune (Step 4): `hidden` manca quando è falsa, `rune` porta cosa fa quando scatta.
  hidden: loose,
  rune: loose,
  // Solo per borrow_movement (Step 6): il tipo preso in prestito.
  borrow_as: loose,
});
const wireRuneSpecSchema = z.object({ on_enter: nonEmptyString });

/** Uno stato attivo sul filo → modello. `-1` = permanente (le rune, ASSUMPTIONS S9); altri negativi a 0. */
function decodeActiveEffect(ctx: Ctx, effect: z.infer<typeof wireActiveEffectSchema>): ActiveEffect {
  const remainingTurns =
    effect.remaining_turns === PERMANENT_TURNS ? PERMANENT_TURNS : clampNonNegative(ctx, effect.remaining_turns, 'remaining_turns');
  const base: ActiveEffect = {
    kind: effect.kind,
    remainingTurns,
    sourceSpellId: effect.source_spell_id !== undefined && effect.source_spell_id !== '' ? effect.source_spell_id : null,
  };
  if (effect.kind === 'borrow_movement') {
    return isOneOf(PIECE_NAMES, effect.borrow_as) ? { ...base, borrowAs: effect.borrow_as } : base;
  }
  if (effect.kind !== 'rune') return base;
  const spec = parseWith(wireRuneSpecSchema, effect.rune);
  if (!spec.ok) warn(ctx, 'active_effect_malformed', `rune: ${spec.issues.join('; ')}`);
  const owner = parseWith(colorSchema, effect.caster);
  return {
    ...base,
    hidden: effect.hidden === true,
    ...(owner.ok ? { owner: owner.data } : {}),
    ...(spec.ok ? { onEnter: spec.data.on_enter } : {}),
  };
}
const wireSquareEffectsSchema = z.object({ square: squareSchema, effects: z.array(wireActiveEffectSchema) });

/** Stati per casa: `active_effects` (sui pezzi) e `square_effects` (sulle case) hanno la stessa forma. */
function decodeActiveEffects(ctx: Ctx, raw: unknown, field = 'active_effects'): SquareEffects[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(ctx, 'active_effect_malformed', `${field} non è un array`);
    return [];
  }
  const out: SquareEffects[] = [];
  raw.forEach((item: unknown, index) => {
    const parsed = parseWith(wireSquareEffectsSchema, item);
    if (!parsed.ok) {
      warn(ctx, 'active_effect_malformed', `${field}[${index}]: ${parsed.issues.join('; ')}`);
      return;
    }
    const effects: ActiveEffect[] = parsed.data.effects.map((effect) => decodeActiveEffect(ctx, effect));
    out.push({ square: parsed.data.square, effects });
  });
  return out;
}

// --- Identità dei giocatori (`game/room.go:1350-1366`, ASSUMPTIONS C1) ---------------------------

const wirePlayerSchema = z.object({ id: wireId, username: nonEmptyString, bot: loose });

/** Il bot di un lato (`bot` del giocatore, `white_bot`/`black_bot` dello storico): assente = una persona; un livello sconosciuto resta un bot, con un warning. */
function decodeBotLevel(ctx: Ctx, raw: unknown, field: string): BotIdentity | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return readEnum(ctx, raw, BOT_LEVELS, field);
}

function decodePlayers(ctx: Ctx, white: unknown, black: unknown): MatchPlayers | null {
  const w = parseWith(wirePlayerSchema, white);
  const b = parseWith(wirePlayerSchema, black);
  if (!w.ok || !b.ok) {
    warn(ctx, 'players_missing');
    return null;
  }
  const player = (p: typeof w.data, field: string) => {
    const bot = decodeBotLevel(ctx, p.bot, field);
    return bot === null ? { id: p.id, username: p.username } : { id: p.id, username: p.username, bot };
  };
  return { white: player(w.data, 'white_player.bot'), black: player(b.data, 'black_player.bot') };
}

// --- Time control (`game/room.go:1367-1370`) -------------------------------------------------------

const wireTimeControlSchema = z.object({ base_ms: count, increment_ms: count });

function decodeTimeControl(ctx: Ctx, raw: unknown): TimeControl | null {
  if (raw === undefined || raw === null) return null;
  const parsed = parseWith(wireTimeControlSchema, raw);
  if (!parsed.ok) {
    warn(ctx, 'value_invalid', `time_control: ${parsed.issues.join('; ')}`);
    return null;
  }
  return {
    baseMs: clampNonNegative(ctx, parsed.data.base_ms, 'time_control.base_ms'),
    incrementMs: clampNonNegative(ctx, parsed.data.increment_ms, 'time_control.increment_ms'),
  };
}

// --- Mosse giocate (`game/room.go:37,488-490`) ------------------------------------------------------

/** `NullMove`: la mossa consumata da uno scudo, senza pezzi spostati. */
const ABSORBED_MOVE = '0000';

function decodeMoves(moves: readonly string[]): PlayedMove[] {
  return moves.map((uci) => (uci === ABSORBED_MOVE ? { kind: 'absorbed' } : { kind: 'move', uci }));
}

// --- Effetti applicati (`game/room.go:740-853`) ----------------------------------------------------

const PIECE_NAMES: readonly PieceKind[] = PIECE_KINDS;

const APPLIED_EFFECT_SCHEMAS = {
  noop: z.object({}),
  destroy_piece: z.object({ target: squareSchema, piece_destroyed: loose }),
  freeze_piece: z.object({ target: squareSchema, remaining_turns: count }),
  shield_piece: z.object({ target: squareSchema, remaining_turns: count }),
  move_piece: z.object({ from: squareSchema, to: squareSchema }),
  draw_card: z.object({ count }),
  gain_mana: z.object({ amount: count, mana: count }),
  summon_pawn: z.object({ target: squareSchema, piece: loose }),
  mass: z.object({ targets: z.array(squareSchema), remaining_turns: count }),
  swap_pieces: z.object({ targets: z.array(squareSchema) }),
  create_wall: z.object({ target: squareSchema, remaining_turns: count }),
  create_square_effect: z.object({ target: squareSchema, effect: nonEmptyString, remaining_turns: count }),
  place_rune: z.object({ targets: z.array(squareSchema), on_enter: nonEmptyString }),
  reveal_runes: z.object({ side: colorSchema }),
  detonate_runes: z.object({ runes: z.array(squareSchema), targets: z.array(squareSchema), remaining_turns: count }),
  add_trigger: z.object({ on: nonEmptyString, do: nonEmptyString, remaining_turns: z.number().int() }),
  add_aura: z.object({ grant: nonEmptyString, active: z.boolean() }),
  add_effect: z.object({ target: squareSchema, effect: nonEmptyString, remaining_turns: count }),
  borrow_movement: z.object({ target: squareSchema, piece: loose }),
  extra_move: z.object({ pieces: z.array(z.string()), no_capture: z.boolean() }),
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
    case 'freeze_all':
    case 'shield_area': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.mass, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      return { kind, targets: p.data.targets, remainingTurns: clampNonNegative(ctx, p.data.remaining_turns, 'remaining_turns') };
    }
    case 'swap_pieces': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.swap_pieces, raw);
      return p.ok ? { kind, targets: p.data.targets } : unknown(p.issues.join('; '));
    }
    case 'restore_castling_rights':
      return { kind };
    case 'create_wall': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.create_wall, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      return { kind, target: p.data.target, state: 'wall', remainingTurns: clampNonNegative(ctx, p.data.remaining_turns, 'remaining_turns') };
    }
    case 'create_square_effect': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.create_square_effect, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      return {
        kind,
        target: p.data.target,
        state: p.data.effect,
        remainingTurns: clampNonNegative(ctx, p.data.remaining_turns, 'remaining_turns'),
      };
    }
    case 'place_rune': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.place_rune, raw);
      return p.ok ? { kind, targets: p.data.targets, onEnter: p.data.on_enter } : unknown(p.issues.join('; '));
    }
    case 'reveal_runes': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.reveal_runes, raw);
      return p.ok ? { kind, side: p.data.side } : unknown(p.issues.join('; '));
    }
    case 'detonate_runes': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.detonate_runes, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      return { kind, runes: p.data.runes, targets: p.data.targets, remainingTurns: clampNonNegative(ctx, p.data.remaining_turns, 'remaining_turns') };
    }
    case 'hidden_effect':
      return { kind };
    case 'add_trigger': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.add_trigger, raw);
      return p.ok ? { kind, on: p.data.on, do: p.data.do, remainingTurns: p.data.remaining_turns } : unknown(p.issues.join('; '));
    }
    case 'add_aura': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.add_aura, raw);
      return p.ok ? { kind, grant: p.data.grant, active: p.data.active } : unknown(p.issues.join('; '));
    }
    case 'add_effect': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.add_effect, raw);
      return p.ok ? { kind, target: p.data.target, effect: p.data.effect, remainingTurns: p.data.remaining_turns } : unknown(p.issues.join('; '));
    }
    case 'borrow_movement': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.borrow_movement, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      const piece = p.data.piece;
      return { kind, target: p.data.target, piece: isOneOf(PIECE_NAMES, piece) ? piece : readEnum(ctx, piece, PIECE_NAMES, 'piece') };
    }
    case 'extra_move': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.extra_move, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      return { kind, pieces: p.data.pieces.filter((x): x is PieceKind => isOneOf(PIECE_NAMES, x)), noCapture: p.data.no_capture };
    }
    case 'summon_pawn':
    case 'transform_piece':
    case 'promote_piece':
    case 'revive_piece': {
      const p = parseWith(APPLIED_EFFECT_SCHEMAS.summon_pawn, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      const piece = p.data.piece;
      return { kind, target: p.data.target, piece: isOneOf(PIECE_NAMES, piece) ? piece : readEnum(ctx, piece, PIECE_NAMES, 'piece') };
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

// `game/room.go:556-561` (`move_played`) e `1495-1500` (`declined`). Senza `reason` resta un rifiuto.
const decodeDrawDeclined: Decoder<'draw_declined'> = (payload, ctx) => {
  const raw = isRecord(payload) ? payload['reason'] : undefined;
  return { ok: true, event: { type: 'draw_declined', reason: raw === undefined ? 'declined' : readEnum(ctx, raw, DRAW_DECLINE_REASONS, 'reason') } };
};
const decodeOpponentDisconnected: Decoder<'opponent_disconnected'> = () => ({
  ok: true,
  event: { type: 'opponent_disconnected' },
});
const decodeOpponentReconnected: Decoder<'opponent_reconnected'> = () => ({
  ok: true,
  event: { type: 'opponent_reconnected' },
});

const manaNumber = z.number();

// `game/room.go:1360-1386` (+ `reconnected` da `game/room.go:1136`).
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
  white_graveyard: loose,
  black_graveyard: loose,
  square_effects: loose,
  triggers: loose,
  auras: loose,
  special_moves: loose,
  extra_move: loose,
  reconnected: loose,
  white_player: loose,
  black_player: loose,
  time_control: loose,
  friendly: loose,
});

const decodeGameState: Decoder<'game_state'> = (payload, ctx) =>
  withCore(gameStateSchema, payload, (core) => {
    const n = (value: number, field: string) => clampNonNegative(ctx, value, field);
    const perColor = <T>(white: T, black: T): PerColor<T> => ({ white, black });
    return {
      type: 'game_state',
      state: {
        fen: core.board.fen,
        moves: decodeMoves(core.board.moves),
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
        graveyards: perColor(decodeGraveyard(ctx, core.white_graveyard, 'white_graveyard'), decodeGraveyard(ctx, core.black_graveyard, 'black_graveyard')),
        // Assente nei server precedenti allo Step 3 del catalogo: nessuno stato sulle case (ASSUMPTIONS S7).
        squareStates: decodeActiveEffects(ctx, core.square_effects, 'square_effects'),
        // Assenti nei server precedenti allo Step 5: nessun trigger né aura (ASSUMPTIONS S12).
        playerEffects: decodePlayerEffects(ctx, core.triggers, core.auras),
        // Assenti nei server precedenti allo Step 6: nessuna mossa speciale (ASSUMPTIONS S15).
        moveOptions: decodeMoveOptions(ctx, core.special_moves, core.extra_move),
        reconnected: core.reconnected === true,
        players: decodePlayers(ctx, core.white_player, core.black_player),
        timeControl: decodeTimeControl(ctx, core.time_control),
        friendly: core.friendly === true,
      },
    };
  });

/** Cimitero: lista di tipi di pezzo; assente (server precedente) = vuoto, tipi sconosciuti scartati con warning. */
function decodeGraveyard(ctx: Ctx, raw: unknown, field: string): PieceKind[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(ctx, 'value_invalid', field);
    return [];
  }
  return raw.map((piece, index) => readEnum(ctx, piece, PIECE_NAMES, `${field}[${index}]`)).filter((piece) => piece !== 'unknown');
}

const decodeGraveyardChanged: Decoder<'graveyard_changed'> = (payload, ctx) =>
  withCore(z.object({ player: colorSchema, graveyard: loose }), payload, (core) => ({
    type: 'graveyard_changed',
    player: core.player,
    graveyard: decodeGraveyard(ctx, core.graveyard, 'graveyard'),
  }));

// --- Trigger e aure (`game/events.go`, Step 5) -----------------------------------------------------

const wireTriggerSchema = z.object({
  player: colorSchema,
  on: nonEmptyString,
  do: nonEmptyString,
  remaining_turns: z.number().int(),
  source_spell_id: z.string().optional(),
  hidden: z.boolean().optional(),
});
const wireAuraSchema = z.object({
  player: colorSchema,
  grant: nonEmptyString,
  active: z.boolean(),
  min_own_pawns: count.optional(),
  source_spell_id: z.string().optional(),
});

/** Una lista di voci: quelle malformate si scartano una per una con un warning, mai l'evento intero. */
function decodeList<T>(ctx: Ctx, raw: unknown, field: string, decodeOne: (item: unknown, index: number) => T | null): T[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(ctx, 'value_invalid', field);
    return [];
  }
  return raw.flatMap((item: unknown, index) => {
    const one = decodeOne(item, index);
    return one === null ? [] : [one];
  });
}

const spellIdOrNull = (id: string | undefined) => (id !== undefined && id !== '' ? id : null);

function decodePlayerEffects(ctx: Ctx, triggers: unknown, auras: unknown): PlayerEffects {
  return {
    triggers: decodeList(ctx, triggers, 'triggers', (item, index): PlayerTrigger | null => {
      const p = parseWith(wireTriggerSchema, item);
      if (!p.ok) {
        warn(ctx, 'value_invalid', `triggers[${index}]: ${p.issues.join('; ')}`);
        return null;
      }
      return {
        player: p.data.player,
        on: p.data.on,
        do: p.data.do,
        // -1 = permanente (come per gli stati, S9); gli altri negativi portati a 0.
        remainingTurns: p.data.remaining_turns === PERMANENT_TURNS ? PERMANENT_TURNS : clampNonNegative(ctx, p.data.remaining_turns, 'remaining_turns'),
        sourceSpellId: spellIdOrNull(p.data.source_spell_id),
        hidden: p.data.hidden === true,
      };
    }),
    auras: decodeList(ctx, auras, 'auras', (item, index): PlayerAura | null => {
      const p = parseWith(wireAuraSchema, item);
      if (!p.ok) {
        warn(ctx, 'value_invalid', `auras[${index}]: ${p.issues.join('; ')}`);
        return null;
      }
      return {
        player: p.data.player,
        grant: p.data.grant,
        active: p.data.active,
        minOwnPawns: p.data.min_own_pawns ?? 0,
        sourceSpellId: spellIdOrNull(p.data.source_spell_id),
      };
    }),
  };
}

// --- Opzioni di mossa (`game/special.go`, Step 6) ------------------------------------------------

const uciSchema = z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/);
const wireExtraMoveSchema = z.object({ pieces: z.array(z.string()), no_capture: z.boolean() });

function decodeMoveOptions(ctx: Ctx, specialMoves: unknown, extraMove: unknown): MoveOptions {
  const moves = decodeList(ctx, specialMoves, 'special_moves', (item, index) => {
    const p = parseWith(uciSchema, item);
    if (!p.ok) warn(ctx, 'value_invalid', `special_moves[${index}]`);
    return p.ok ? p.data : null;
  });
  if (extraMove === undefined || extraMove === null) return { specialMoves: moves, extraMove: null };
  const extra = parseWith(wireExtraMoveSchema, extraMove);
  if (!extra.ok) {
    warn(ctx, 'value_invalid', `extra_move: ${extra.issues.join('; ')}`);
    return { specialMoves: moves, extraMove: null };
  }
  return {
    specialMoves: moves,
    extraMove: { pieces: extra.data.pieces.filter((x): x is PieceKind => isOneOf(PIECE_NAMES, x)), noCapture: extra.data.no_capture },
  };
}

const decodeMoveOptionsEvent: Decoder<'move_options'> = (payload, ctx) =>
  withCore(z.object({ special_moves: loose, extra_move: loose }), payload, (core) => ({
    type: 'move_options',
    moveOptions: decodeMoveOptions(ctx, core.special_moves, core.extra_move),
  }));

const decodePlayerEffectsChanged: Decoder<'player_effects_changed'> = (payload, ctx) =>
  withCore(z.object({ triggers: loose, auras: loose }), payload, (core) => ({
    type: 'player_effects_changed',
    playerEffects: decodePlayerEffects(ctx, core.triggers, core.auras),
  }));

const TRIGGER_RESULT_SCHEMAS = {
  draw_card: z.object({ count }),
  freeze_piece: z.object({ target: squareSchema, remaining_turns: count }),
} as const;

function decodeTriggerResult(ctx: Ctx, raw: unknown): TriggerResult {
  const kind = isRecord(raw) && typeof raw['kind'] === 'string' ? raw['kind'] : '';
  const unknown = (detail: string): TriggerResult => {
    warn(ctx, 'effect_unknown', `trigger_fired.result: ${detail}`);
    return { kind: 'unknown', rawKind: kind };
  };
  switch (kind) {
    case 'draw_card': {
      const p = parseWith(TRIGGER_RESULT_SCHEMAS.draw_card, raw);
      return p.ok ? { kind, count: p.data.count } : unknown(p.issues.join('; '));
    }
    case 'freeze_piece': {
      const p = parseWith(TRIGGER_RESULT_SCHEMAS.freeze_piece, raw);
      return p.ok ? { kind, target: p.data.target, remainingTurns: p.data.remaining_turns } : unknown(p.issues.join('; '));
    }
    default:
      return unknown(`kind ${JSON.stringify(kind)}`);
  }
}

const decodeTriggerFired: Decoder<'trigger_fired'> = (payload, ctx) =>
  withCore(
    z.object({ player: colorSchema, on: nonEmptyString, do: nonEmptyString, source_spell_id: z.string().optional(), result: loose }),
    payload,
    (core) => ({
      type: 'trigger_fired',
      player: core.player,
      on: core.on,
      do: core.do,
      sourceSpellId: spellIdOrNull(core.source_spell_id),
      result: decodeTriggerResult(ctx, core.result),
    }),
  );

const decodeAuraChanged: Decoder<'aura_changed'> = (payload) =>
  withCore(z.object({ player: colorSchema, grant: nonEmptyString, active: z.boolean() }), payload, (core) => ({
    type: 'aura_changed',
    player: core.player,
    grant: core.grant,
    active: core.active,
  }));

const decodeSquareEffectsChanged: Decoder<'square_effects_changed'> = (payload, ctx) =>
  withCore(z.object({ square_effects: loose }), payload, (core) => ({
    type: 'square_effects_changed',
    squareStates: decodeActiveEffects(ctx, core.square_effects, 'square_effects'),
  }));

// `game/room.go:1004-1019`
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

// `game/room.go:697-704,979-986`: `card_id` è lo spell_id.
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

// `game/room.go:685-690`. `targets` ed `effects_applied` tollerati anche `null`.
// `game/room.go` handleCastSpell. Una magia nascosta (una runa dell'avversario) arriva con `hidden: true`, senza
// `spell_id` né `targets` (ASSUMPTIONS M42): diventa `spellId: null` e nessun bersaglio.
const spellCastSchema = z.object({ player: colorSchema, spell_id: nonEmptyString, targets: nullableList(z.unknown()), effects_applied: loose });
const hiddenSpellCastSchema = z.object({ player: colorSchema, effects_applied: loose });

function decodeAppliedEffects(ctx: Ctx, raw: unknown): AppliedEffect[] {
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) warn(ctx, 'effect_unknown', 'effects_applied non è un array');
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  return list.map((effect, index) => decodeAppliedEffect(ctx, effect, index));
}

const decodeSpellCast: Decoder<'spell_cast'> = (payload, ctx) => {
  if (isRecord(payload) && payload['hidden'] === true) {
    return withCore(hiddenSpellCastSchema, payload, (core) => ({
      type: 'spell_cast',
      player: core.player,
      spellId: null,
      targets: [],
      effects: decodeAppliedEffects(ctx, core.effects_applied),
    }));
  }
  return withCore(spellCastSchema, payload, (core) => {
    const targets = core.targets.filter(isSquare);
    if (targets.length !== core.targets.length) warn(ctx, 'value_invalid', 'spell_cast.targets');
    return {
      type: 'spell_cast',
      player: core.player,
      spellId: core.spell_id,
      targets,
      effects: decodeAppliedEffects(ctx, core.effects_applied),
    };
  });
};

// `game/room.go` triggerRune: lo stato aggiornato arriva a parte, qui solo cosa è successo.
const RUNE_RESULT_SCHEMAS = {
  freeze_piece: z.object({ target: squareSchema, remaining_turns: count }),
  return_to_origin: z.object({ from: squareSchema, to: squareSchema }),
  destroy_piece: z.object({ target: squareSchema, piece_destroyed: loose }),
} as const;

function decodeRuneResult(ctx: Ctx, raw: unknown): RuneResult {
  const kind = isRecord(raw) && typeof raw['kind'] === 'string' ? raw['kind'] : '';
  const unknown = (detail: string): RuneResult => {
    warn(ctx, 'effect_unknown', `rune_triggered.result: ${detail}`);
    return { kind: 'unknown', rawKind: kind };
  };
  switch (kind) {
    case 'freeze_piece': {
      const p = parseWith(RUNE_RESULT_SCHEMAS.freeze_piece, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      return { kind, target: p.data.target, remainingTurns: clampNonNegative(ctx, p.data.remaining_turns, 'remaining_turns') };
    }
    case 'return_to_origin': {
      const p = parseWith(RUNE_RESULT_SCHEMAS.return_to_origin, raw);
      return p.ok ? { kind, from: p.data.from, to: p.data.to } : unknown(p.issues.join('; '));
    }
    case 'destroy_piece': {
      const p = parseWith(RUNE_RESULT_SCHEMAS.destroy_piece, raw);
      if (!p.ok) return unknown(p.issues.join('; '));
      const destroyed = p.data.piece_destroyed;
      return {
        kind,
        target: p.data.target,
        destroyedPiece: isOneOf(PIECE_NAMES, destroyed) ? destroyed : readEnum(ctx, destroyed, PIECE_NAMES, 'piece_destroyed'),
      };
    }
    default:
      return unknown(`kind ${JSON.stringify(kind)}`);
  }
}

const decodeRuneTriggered: Decoder<'rune_triggered'> = (payload, ctx) =>
  withCore(z.object({ square: squareSchema, owner: colorSchema, on_enter: nonEmptyString, result: loose }), payload, (core) => ({
    type: 'rune_triggered',
    square: core.square,
    owner: core.owner,
    onEnter: core.on_enter,
    result: decodeRuneResult(ctx, core.result),
  }));

// `game/room.go:548-555` (scudo consumato) e `902-916` (scadenza).
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

// `game/room.go:1258-1265`: `winner` assente in caso di patta.
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
  graveyard_changed: decodeGraveyardChanged,
  square_effects_changed: decodeSquareEffectsChanged,
  rune_triggered: decodeRuneTriggered,
  player_effects_changed: decodePlayerEffectsChanged,
  trigger_fired: decodeTriggerFired,
  aura_changed: decodeAuraChanged,
  move_options: decodeMoveOptionsEvent,
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
// §3b Errori WebSocket: codici e dettagli (`game/client.go:126-137`, `gameerr/gameerr.go`)
// ===================================================================================================

/** `details` di `gameerr.Error`: solo i campi che servono alla UI, ciascuno letto in modo tollerante. */
const wireErrorDetailsSchema = z.object({
  square: loose,
  phase: loose,
  needed: loose,
  available: loose,
  expected: loose,
  received: loose,
  king: loose,
  index: loose,
  reason: loose,
  per_turn: loose,
});

const intOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

/**
 * `{message, code, details?}`. Il testo resta sul filo solo per il debug e qui viene scartato. Un `code` mancante
 * o sconosciuto diventa `null`: la UI mostra un errore generico legato all'azione in volo (G6).
 */
function interpretWsError(ctx: Ctx, payload: unknown): ProtocolErrorInfo {
  const record = isRecord(payload) ? payload : {};
  const rawCode = record['code'];
  let code: ProtocolErrorCode | null = null;
  if (isOneOf(PROTOCOL_ERROR_CODES, rawCode)) code = rawCode;
  else if (typeof rawCode === 'string') warn(ctx, 'error_code_unknown', rawCode);
  else warn(ctx, 'error_code_missing', isRecord(payload) ? 'nessun code' : typeof payload);

  const parsed = parseWith(wireErrorDetailsSchema, isRecord(record['details']) ? record['details'] : {});
  const details = parsed.ok ? parsed.data : {};
  const square = details.square;
  const phase = details.phase;
  const king = details.king;
  return {
    code,
    square: isSquare(square) ? square : null,
    phase: isOneOf(PHASES, phase) ? phase : null,
    needed: intOrNull(details.needed),
    available: intOrNull(details.available),
    expected: intOrNull(details.expected),
    received: intOrNull(details.received),
    king: isOneOf(COLORS, king) ? king : null,
    index: intOrNull(details.index),
    reason: typeof details.reason === 'string' && details.reason !== '' ? details.reason : null,
    perTurn: intOrNull(details.per_turn),
  };
}

// ===================================================================================================
// §4 Encoder WebSocket in uscita (`game/room.go:365-408`)
// ===================================================================================================

type WireClientMessage =
  | { readonly type: 'move'; readonly payload: { readonly move: string } }
  | {
      readonly type: 'resign' | 'draw_offer' | 'draw_accepted' | 'draw_declined' | 'pass_phase';
      readonly payload: Record<string, never>;
    }
  | {
      readonly type: 'cast_spell';
      readonly payload: { readonly spell_id: string; readonly targets: readonly string[]; readonly choice?: { readonly piece: string } };
    };

export function encodeClientIntent(intent: ClientIntent): string {
  let message: WireClientMessage;
  switch (intent.type) {
    case 'move':
      message = { type: 'move', payload: { move: intent.move } };
      break;
    case 'cast_spell':
      // Il server identifica la carta per spell_id (`match/match.go:318`): l'id locale non viaggia.
      message = {
        type: 'cast_spell',
        payload:
          intent.choice === null
            ? { spell_id: intent.card.spellId, targets: [...intent.targets] }
            : { spell_id: intent.card.spellId, targets: [...intent.targets], choice: { piece: intent.choice } },
      };
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

interface ErrorTextRule<C extends string> {
  readonly pattern: RegExp;
  readonly code: C;
}

function matchErrorText<C extends string>(rules: readonly ErrorTextRule<C>[], message: string): C | null {
  return rules.find((rule) => rule.pattern.test(message))?.code ?? null;
}

/** Testi esatti degli errori REST: la REST non ha codici (P1-3 applicata solo al WebSocket, ASSUMPTIONS C4). */
export const HTTP_ERROR_TEXTS: readonly ErrorTextRule<HttpErrorCode>[] = [
  { pattern: /^Dati non validi$/, code: 'invalid_request' }, // handlers/auth.go:27,98,197; handlers/decks.go
  { pattern: /^Hai già il numero massimo di mazzi$/, code: 'deck_limit' }, // handlers/decks.go
  { pattern: /^Nome del mazzo non valido$/, code: 'deck_name_invalid' },
  { pattern: /^Carta non presente nel catalogo$/, code: 'deck_unknown_spell' },
  { pattern: /^Troppe copie di una carta$/, code: 'deck_too_many_copies' },
  { pattern: /^Copie non possedute$/, code: 'deck_not_owned' },
  { pattern: /^Il mazzo non è valido$/, code: 'deck_not_valid' },
  { pattern: /^Non puoi eliminare l'ultimo mazzo$/, code: 'deck_last' },
  { pattern: /^Mazzo non trovato$/, code: 'deck_not_found' },
  { pattern: /^Non puoi sfidare te stesso$/, code: 'challenge_self' }, // handlers/challenges.go
  { pattern: /^Giocatore non trovato$/, code: 'challenge_player_not_found' },
  { pattern: /^Il giocatore non è online$/, code: 'challenge_offline' },
  { pattern: /^Il giocatore è in partita$/, code: 'challenge_target_busy' },
  { pattern: /^Sei già in partita$/, code: 'challenge_self_busy' },
  { pattern: /^Sfida non trovata$/, code: 'challenge_not_found' },
  { pattern: /^Devi accettare i termini e confermare di avere almeno \d+ anni$/, code: 'consent_required' }, // handlers/auth.go
  { pattern: /^Versione dei termini non valida$/, code: 'terms_version_invalid' }, // handlers/privacy.go
  { pattern: /^Password non corretta$/, code: 'wrong_password' },
  { pattern: /^Account non trovato$/, code: 'account_not_found' },
  { pattern: /^Non puoi aggiungere te stesso$/, code: 'friend_self' }, // handlers/friendships.go
  { pattern: /^Siete già amici$/, code: 'friend_already' },
  { pattern: /^Richiesta già inviata$/, code: 'friend_pending' },
  { pattern: /^Hai raggiunto il numero massimo di amici$/, code: 'friend_limit' },
  { pattern: /^Il giocatore ha raggiunto il numero massimo di amici$/, code: 'friend_their_limit' },
  { pattern: /^Hai troppe richieste in sospeso$/, code: 'friend_pending_limit' },
  { pattern: /^Richiesta non trovata$/, code: 'friend_request_not_found' },
  { pattern: /^Amico non trovato$/, code: 'friend_not_found' },
  { pattern: /^Non puoi bloccare te stesso$/, code: 'block_self' },
  { pattern: /^Giocatore non bloccato$/, code: 'block_not_found' },
  { pattern: /^Ricerca troppo corta$/, code: 'search_too_short' },
  { pattern: /^Username, email e password sono obbligatori$/, code: 'missing_fields' }, // handlers/auth.go:37
  { pattern: /^username deve avere almeno \d+ caratteri$/, code: 'username_too_short' }, // validation/validation.go:64
  { pattern: /^username non può superare \d+ caratteri$/, code: 'username_too_long' }, // validation/validation.go:67
  { pattern: /^username può contenere solo lettere, numeri e underscore$/, code: 'username_invalid_chars' }, // validation/validation.go:70
  { pattern: /^email non valida$/, code: 'email_invalid' }, // validation/validation.go:75
  { pattern: /^password deve avere almeno \d+ caratteri$/, code: 'password_too_short' }, // validation/validation.go:88
  { pattern: /^password non può superare \d+ caratteri$/, code: 'password_too_long' }, // validation/validation.go:92
  { pattern: /^password deve contenere almeno una lettera maiuscola$/, code: 'password_needs_uppercase' }, // validation/validation.go:108
  { pattern: /^password deve contenere almeno una lettera minuscola$/, code: 'password_needs_lowercase' }, // validation/validation.go:111
  { pattern: /^password deve contenere almeno un numero$/, code: 'password_needs_digit' }, // validation/validation.go:114
  { pattern: /^Username o email già in uso$/, code: 'username_or_email_taken' }, // handlers/auth.go:78
  { pattern: /^Credenziali non valide$/, code: 'invalid_credentials' }, // handlers/auth.go:116,126
  { pattern: /^Refresh token non valido o scaduto$/, code: 'refresh_token_invalid' }, // handlers/auth.go:210
  { pattern: /^Token non valido o scaduto$/, code: 'token_invalid_or_expired' }, // middleware/auth.go:42
  { pattern: /^Token non valido$/, code: 'token_invalid' }, // handlers/auth.go:222
  { pattern: /^Token mancante$/, code: 'token_missing' }, // middleware/auth.go:36
  { pattern: /^Ticket non valido o scaduto$/, code: 'ticket_invalid' }, // middleware/wsticket.go:88
  { pattern: /^Utente non trovato$/, code: 'user_not_found' }, // handlers/auth.go:236; handlers/stats.go:134
  { pattern: /^Troppe richieste, rallenta!$/, code: 'rate_limited' }, // middleware/ratelimit.go:87
  { pattern: /^ID non valido$/, code: 'invalid_id' }, // handlers/stats.go:60,119
  { pattern: /^Risorsa non trovata$/, code: 'not_found' }, // api/router.go:33
  { pattern: /^Metodo non consentito$/, code: 'method_not_allowed' }, // api/router.go:34
  {
    pattern: /^(Errore interno|Errore generazione token|Errore generazione ticket|Errore recupero profilo|Errore recupero collezione|Errore DB)$/,
    code: 'internal_error',
  }, // handlers/auth.go:59,137,145,247,257,288; handlers/ws.go:30; handlers/stats.go:25,82; handlers/collection.go
];

export type HttpOutcome =
  | { readonly ok: true; readonly data: unknown; readonly warnings: readonly AdapterWarning[] }
  | { readonly ok: false; readonly error: HttpErrorInfo; readonly warnings: readonly AdapterWarning[] };

/**
 * Interpreta una risposta HTTP a partire dal corpo testuale. L'inviluppo è `{success, data?, error?}`
 * (`models/response.go:5-9`), anche per 404 e 405 (`api/router.go:33-34`).
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
  let code: HttpErrorCode | null = text === null ? null : matchErrorText(HTTP_ERROR_TEXTS, text);
  if (code === null) {
    if (status === 404) code = 'not_found';
    else if (status === 405) code = 'method_not_allowed';
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
  // Assenti sui server precedenti alla privacy (P2, P6): nessun controllo dei termini, stato visibile.
  terms_version: count.min(0).optional(),
  terms_current: count.min(0).optional(),
  hide_presence: z.boolean().optional(),
});

function toAccount(user: z.output<typeof wireAccountSchema>): UserAccount {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    elo: user.elo,
    createdAt: user.created_at,
    termsVersion: user.terms_version ?? null,
    termsCurrent: user.terms_current ?? null,
    hidePresence: user.hide_presence ?? false,
  };
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

/** `GET /leaderboard` (`handlers/stats.go:14-51`): `[]` se vuota; `null` resta tollerato. */
export function normalizeLeaderboard(data: unknown): Normalized<readonly LeaderboardEntry[]> {
  const entry = z.object({ rank: count, id: wireId, username: nonEmptyString, elo: z.number() });
  return normalize(nullableList(entry), data, (list) => list);
}

/**
 * `GET /me/collection` (`handlers/collection.go`): le voci malformate si scartano una per una (come il catalogo,
 * G10); possedute e totale restano quelli del server.
 */
export function normalizeCollection(data: unknown): Normalized<CardCollection> {
  const schema = z.object({ cards: nullableList(z.unknown()), owned: count.min(0), total: count.min(0) });
  const entry = z
    .object({ spell_id: nonEmptyString, copies: count.min(0), max_copies: count.min(1) })
    .refine((e) => e.copies <= e.max_copies, 'copies > max_copies');
  const ctx = createCtx();
  const parsed = parseWith(schema, data);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const cards: CollectionCard[] = [];
  parsed.data.cards.forEach((raw, index) => {
    const card = parseWith(entry, raw);
    if (!card.ok) {
      warn(ctx, 'collection_entry_invalid', `[${index}] ${card.issues.join('; ')}`);
      return;
    }
    cards.push({ spellId: card.data.spell_id, copies: card.data.copies, maxCopies: card.data.max_copies });
  });
  return { ok: true, value: { cards, owned: parsed.data.owned, total: parsed.data.total }, warnings: ctx.warnings };
}

const wireDeckSchema = z.object({
  id: wireId,
  name: nonEmptyString,
  cards: nullableList(z.object({ spell_id: nonEmptyString, copies: count.min(1) })),
  size: count.min(0),
  valid: z.boolean(),
  active: z.boolean(),
  updated_at: z.string(),
});

function toDeck(wire: z.output<typeof wireDeckSchema>): Deck {
  const cards = new Map<string, number>();
  for (const card of wire.cards) cards.set(card.spell_id, (cards.get(card.spell_id) ?? 0) + card.copies);
  return { id: wire.id, name: wire.name, cards, size: wire.size, valid: wire.valid, active: wire.active, updatedAt: wire.updated_at };
}

/** Un mazzo (`POST`/`PUT /me/decks`, `handlers/decks.go`). */
export function normalizeDeck(data: unknown): Normalized<Deck> {
  return normalize(wireDeckSchema, data, toDeck);
}

/**
 * `GET /me/decks` (e le risposte di `DELETE` e `activate`): un mazzo malformato si scarta con un warning, come le
 * voci del catalogo (G10); il resto della lista resta.
 */
export function normalizeDeckList(data: unknown): Normalized<DeckList> {
  const schema = z.object({ decks: nullableList(z.unknown()), max_decks: count.min(1), deck_size: count.min(1) });
  const ctx = createCtx();
  const parsed = parseWith(schema, data);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const decks: Deck[] = [];
  parsed.data.decks.forEach((raw, index) => {
    const deck = parseWith(wireDeckSchema, raw);
    if (!deck.ok) {
      warn(ctx, 'deck_entry_invalid', `[${index}] ${deck.issues.join('; ')}`);
      return;
    }
    decks.push(toDeck(deck.data));
  });
  return { ok: true, value: { decks, maxDecks: parsed.data.max_decks, deckSize: parsed.data.deck_size }, warnings: ctx.warnings };
}

/** Corpo di `POST`/`PUT /me/decks`: `{name, cards: [{spell_id, copies}]}`, per id. */
export function encodeDeck(name: string, cards: ReadonlyMap<string, number>): string {
  const list = [...cards.entries()]
    .filter(([, copies]) => copies > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([spellId, copies]) => ({ spell_id: spellId, copies }));
  return JSON.stringify({ name, cards: list });
}

/** `GET /users/{id}/games` (`handlers/stats.go:54-108`): `[]` se vuota; `null` resta tollerato. */
export function normalizeGameHistory(data: unknown): Normalized<readonly GameHistoryEntry[]> {
  const entry = z.object({
    id: wireId,
    white_id: wireId.optional(),
    black_id: wireId.optional(),
    rated: z.boolean().optional(),
    white_deleted: z.boolean().optional(),
    black_deleted: z.boolean().optional(),
    white_bot: loose,
    black_bot: loose,
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
    whiteId: g.white_id ?? null,
    blackId: g.black_id ?? null,
    rated: g.rated ?? true,
    whiteDeleted: g.white_deleted === true,
    blackDeleted: g.black_deleted === true,
    whiteBot: decodeBotLevel(ctx, g.white_bot, 'white_bot'),
    blackBot: decodeBotLevel(ctx, g.black_bot, 'black_bot'),
    white: g.white,
    black: g.black,
    result: readEnum(ctx, g.result, GAME_RESULTS, 'result'),
    timeControl: g.time_control,
    pgn: g.pgn,
    playedAt: g.played_at,
  }));
  return { ok: true, value, warnings: ctx.warnings };
}

const wireChallengePlayer = z.object({ id: wireId, username: nonEmptyString, elo: z.number() });
const wireChallengeSchema = z.object({ id: nonEmptyString, from: wireChallengePlayer, to: wireChallengePlayer, expires_in: count });

function toChallenge(wire: z.output<typeof wireChallengeSchema>): Challenge {
  return { id: wire.id, from: wire.from, to: wire.to, expiresInSeconds: Math.max(0, wire.expires_in) };
}

/**
 * `GET /me/friends` (`handlers/friends.go`): una voce malformata si scarta con un warning; uno stato sconosciuto
 * vale offline (non si può sfidare).
 */
export function normalizeFriendList(data: unknown): Normalized<FriendList> {
  // others, incoming, outgoing e max_friends mancano sui server precedenti alle amicizie vere: liste vuote, limite 200.
  const schema = z.object({
    friends: nullableList(z.unknown()),
    others: nullableList(z.unknown()),
    incoming: nullableList(z.unknown()),
    outgoing: nullableList(z.unknown()),
    online: count.min(0),
    max_friends: count.min(1).optional(),
  });
  const entry = z.object({ id: wireId, username: nonEmptyString, elo: z.number(), status: z.string() });
  const ctx = createCtx();
  const parsed = parseWith(schema, data);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const list = (raws: readonly unknown[], field: string): Friend[] => {
    const out: Friend[] = [];
    raws.forEach((raw, index) => {
      const friend = parseWith(entry, raw);
      if (!friend.ok) {
        warn(ctx, 'friend_entry_invalid', `${field}[${index}] ${friend.issues.join('; ')}`);
        return;
      }
      const status = readEnum(ctx, friend.data.status, FRIEND_STATUSES, 'status');
      out.push({ ...friend.data, status: status === 'unknown' ? 'offline' : status });
    });
    return out;
  };
  const d = parsed.data;
  return {
    ok: true,
    value: {
      friends: list(d.friends, 'friends'),
      others: list(d.others, 'others'),
      incoming: list(d.incoming, 'incoming'),
      outgoing: list(d.outgoing, 'outgoing'),
      online: d.online,
      maxFriends: d.max_friends ?? 200,
    },
    warnings: ctx.warnings,
  };
}

/** `GET /users/search` (A5): un risultato malformato si scarta; una relazione sconosciuta vale «nessuna». */
export function normalizeUserSearch(data: unknown): Normalized<readonly UserSearchResult[]> {
  const entry = z.object({ id: wireId, username: nonEmptyString, elo: z.number(), relation: z.string() });
  const ctx = createCtx();
  const parsed = parseWith(nullableList(z.unknown()), data);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const out: UserSearchResult[] = [];
  parsed.data.forEach((raw, index) => {
    const result = parseWith(entry, raw);
    if (!result.ok) {
      warn(ctx, 'search_entry_invalid', `[${index}] ${result.issues.join('; ')}`);
      return;
    }
    const relation = readEnum(ctx, result.data.relation, RELATIONS, 'relation');
    out.push({ ...result.data, relation: relation === 'unknown' ? 'none' : relation });
  });
  return { ok: true, value: out, warnings: ctx.warnings };
}

/** `GET /me/blocks` e le risposte di blocco e sblocco (A8). */
export function normalizeBlocks(data: unknown): Normalized<readonly BlockedUser[]> {
  return normalize(nullableList(z.object({ id: wireId, username: nonEmptyString })), data, (list) => list);
}

/** Corpo di `POST /me/blocks`: l'id numerico, come sul server. */
export function encodeBlock(userId: string): string {
  return JSON.stringify({ user_id: Number(userId) });
}

/** `POST /me/challenges` (`handlers/challenges.go`). */
export function normalizeChallenge(data: unknown): Normalized<Challenge> {
  return normalize(wireChallengeSchema, data, toChallenge);
}

/** `POST /me/presence` → `{incoming}`: una sfida malformata si scarta. */
export function normalizePresence(data: unknown): Normalized<PresenceUpdate> {
  const ctx = createCtx();
  // friend_requests manca sui server precedenti alle amicizie vere: nessuna richiesta.
  const parsed = parseWith(z.object({ incoming: nullableList(z.unknown()), friend_requests: count.min(0).optional() }), data);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const incoming: Challenge[] = [];
  parsed.data.incoming.forEach((raw, index) => {
    const challenge = parseWith(wireChallengeSchema, raw);
    if (challenge.ok) incoming.push(toChallenge(challenge.data));
    else warn(ctx, 'challenge_entry_invalid', `[${index}] ${challenge.issues.join('; ')}`);
  });
  return { ok: true, value: { incoming, friendRequests: parsed.data.friend_requests ?? 0 }, warnings: ctx.warnings };
}

/** Corpo di `POST /me/challenges` e `POST /me/friends/requests`: l'id del giocatore, numerico come sul server. */
export function encodeChallenge(userId: string): string {
  return JSON.stringify({ to: Number(userId) });
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

/** Corpo di `POST /auth/register`: con il consenso a termini, informativa ed età minima (P1). */
export function encodeRegister(username: string, email: string, password: string, consented: boolean): string {
  return JSON.stringify({ username, email, password, accept_terms: consented, age_confirmed: consented });
}

/**
 * `GET /me/export` (P5): i dati dell'utente da consegnargli così come sono, in un file JSON leggibile. Non si
 * interpretano: basta che sia un oggetto.
 */
export function normalizeExport(data: unknown): Normalized<string> {
  if (!isRecord(data)) return { ok: false, issues: ['export: non è un oggetto'] };
  return { ok: true, value: JSON.stringify(data, null, 2), warnings: [] };
}

/** Corpo di `PUT /me/privacy` (P6). */
export function encodePrivacy(hidePresence: boolean): string {
  return JSON.stringify({ hide_presence: hidePresence });
}

/** Corpo di `DELETE /me` (P3): la password, per conferma. */
export function encodeAccountDeletion(password: string): string {
  return JSON.stringify({ password });
}

/** Corpo di `POST /me/terms`: la versione accettata (P2). */
export function encodeTermsAcceptance(version: number): string {
  return JSON.stringify({ version });
}

export function encodeLogin(email: string, password: string): string {
  return JSON.stringify({ email, password });
}

export function encodeRefresh(refreshToken: string): string {
  return JSON.stringify({ refresh_token: refreshToken });
}

/** `GET /ws/ticket` → `{ticket, expires_in}` (`handlers/ws.go:23-42`). */
export function normalizeWsTicket(data: unknown): Normalized<WsTicket> {
  return normalize(z.object({ ticket: nonEmptyString, expires_in: count }), data, (d) => ({
    ticket: d.ticket,
    expiresInSeconds: d.expires_in,
  }));
}

// ===================================================================================================
// §6 Policy delle credenziali (`validation/validation.go`, ASSUMPTIONS C9)
// ===================================================================================================

/**
 * Riserva usata finché `GET /auth/password-policy` non risponde, o se risponde in modo inatteso: gli stessi valori
 * di `validation/validation.go:11-58`. L'email non fa parte della policy del server: la sua regola (`:22`) resta
 * replicata qui. Servono solo a mostrare i requisiti prima del submit (briefing §7.1); l'autorità resta il server.
 * Le lunghezze della password sono in **byte** (`len()` in Go), quella dello username dopo il trim.
 */
export const FALLBACK_CREDENTIAL_POLICY: CredentialPolicy = {
  username: { minLength: 3, maxLength: 20, pattern: /^[a-zA-Z0-9_]+$/ },
  email: { pattern: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/ },
  password: { minBytes: 8, maxBytes: 72, requireUppercase: true, requireLowercase: true, requireDigit: true },
};

const wirePolicySchema = z.object({
  username: z.object({ min_length: count, max_length: count, pattern: z.string() }),
  password: z.object({
    min_length: count,
    max_length: count,
    require_uppercase: z.boolean(),
    require_lowercase: z.boolean(),
    require_digit: z.boolean(),
  }),
});

/** Compila la regex RE2 del server come `RegExp` JS; se non compila si tiene quella di riserva (C9). */
function compilePattern(ctx: Ctx, pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    warn(ctx, 'password_policy_invalid', `pattern ${JSON.stringify(pattern)}`);
    return FALLBACK_CREDENTIAL_POLICY.username.pattern;
  }
}

/** `GET /auth/password-policy` (`handlers/catalog.go:24-30`, `validation/validation.go:27-58`). */
export function normalizePasswordPolicy(data: unknown): Normalized<CredentialPolicy> {
  const parsed = parseWith(wirePolicySchema, data);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const ctx = createCtx();
  const { username, password } = parsed.data;
  const policy: CredentialPolicy = {
    username: { minLength: username.min_length, maxLength: username.max_length, pattern: compilePattern(ctx, username.pattern) },
    email: FALLBACK_CREDENTIAL_POLICY.email,
    password: {
      minBytes: password.min_length,
      maxBytes: password.max_length,
      requireUppercase: password.require_uppercase,
      requireLowercase: password.require_lowercase,
      requireDigit: password.require_digit,
    },
  };
  return { ok: true, value: policy, warnings: ctx.warnings };
}

// ===================================================================================================
// §7 Catalogo magie (`GET /spells`, `handlers/catalog.go:13-20`; riserva `src/spells/fallback.json`, G10)
// ===================================================================================================

/** `TargetSpec` (`spells/spells.go`): i campi vuoti mancano sul filo (omitempty). */
const wireTargetSpecSchema = z.object({
  type: z.string(),
  pieces: z.array(z.string()).nullable().optional(),
  require_effect: z.string().nullable().optional(),
  empty_square: z.boolean().nullable().optional(),
  max_distance: z.number().nullable().optional(),
  own_ranks: z.array(z.number()).nullable().optional(),
  min_rank: z.number().nullable().optional(),
});

const wireSpellSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  mana_cost: z.number(),
  phases: z.array(z.string()),
  targets: z.array(wireTargetSpecSchema).nullable(),
  effects: z.array(z.object({ kind: z.string(), params: z.record(z.string(), z.unknown()).nullable().optional() })),
  tags: z.array(z.string()).nullable().optional(),
  // Una rarità sconosciuta si legge come comune: cambia solo la cornice della carta.
  rarity: z.string().nullable().optional(),
  limits: z.record(z.string(), z.number()).nullable().optional(),
});

export interface NormalizedCatalog {
  readonly spells: readonly Spell[];
  readonly warnings: readonly AdapterWarning[];
}

/** Accetta un array di magie (forma del server) o `{ spells: [...] }`. Le voci invalide vengono scartate una per una. */
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
      targets: (wire.data.targets ?? []).map((spec) => ({
        type: spec.type,
        pieces: spec.pieces ?? [],
        requireEffect: spec.require_effect ?? null,
        emptySquare: spec.empty_square ?? false,
        maxDistance: spec.max_distance ?? 0,
        ownRanks: spec.own_ranks ?? [],
        minRank: spec.min_rank ?? 0,
      })),
      effects: wire.data.effects.map((effect) => ({ kind: effect.kind, params: effect.params ?? {} })),
      tags: wire.data.tags ?? [],
      rarity: wire.data.rarity === 'legendary' || wire.data.rarity === 'rare' ? wire.data.rarity : 'common',
      perTurn: wire.data.limits?.['per_turn'] ?? null,
    });
    if (!internal.ok) {
      warn(ctx, 'catalog_entry_invalid', `${wire.data.id}: ${internal.issues.join('; ')}`);
      return;
    }
    spells.push(internal.data);
  });
  return { spells, warnings: ctx.warnings };
}
