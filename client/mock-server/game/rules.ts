import { Chess, type Move, type Square } from 'chess.js';

import type { ErrorCode, WireAppliedEffect, WireColor } from '../wire';
import type { MockSpell } from './catalog';
import { toChessColor, type PieceRegistry, type StatusKind } from './pieces';

/**
 * Regole del "server" mock. Il mock è severo: ogni rifiuto ha un codice (M11).
 * Le regole non documentate dal briefing sono in ASSUMPTIONS.md, sezione M.
 */

export interface Board {
  chess: Chess;
  pieces: PieceRegistry;
}

export type Rejection = { ok: false; code: ErrorCode };

export function other(color: WireColor): WireColor {
  return color === 'white' ? 'black' : 'white';
}

export function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

export function cloneBoard(board: Board): Board {
  return { chess: new Chess(board.chess.fen(), { skipValidation: true }), pieces: board.pieces.clone() };
}

export function inCheck(chess: Chess, color: WireColor): boolean {
  const king = chess.findPiece({ type: 'k', color: toChessColor(color) })[0];
  return king !== undefined && chess.isAttacked(king, toChessColor(other(color)));
}

function capturedSquare(move: Move): Square | null {
  if (move.isEnPassant()) return `${move.to[0]}${move.from[1]}` as Square;
  return move.isCapture() ? move.to : null;
}

function castlingRookSquare(move: Move): Square | null {
  if (move.isKingsideCastle()) return `h${move.from[1]}` as Square;
  if (move.isQueensideCastle()) return `a${move.from[1]}` as Square;
  return null;
}

/** Perché una mossa legale per chess.js viene comunque rifiutata: pezzo congelato o bersaglio protetto (M1). */
function moveBlocker(board: Board, move: Move): ErrorCode | null {
  if (board.pieces.hasStatus(move.from, 'freeze')) return 'piece_frozen';
  const rook = castlingRookSquare(move);
  if (rook !== null && board.pieces.hasStatus(rook, 'freeze')) return 'piece_frozen';
  const captured = capturedSquare(move);
  if (captured !== null && board.pieces.hasStatus(captured, 'shield')) return 'target_shielded';
  return null;
}

/** Mosse legali di `color` al netto di congelamenti e Shield. Vuoto se non è `color` a muovere. */
export function filteredMoves(board: Board, color: WireColor): Move[] {
  if (board.chess.turn() !== toChessColor(color)) return [];
  return board.chess.moves({ verbose: true }).filter((move) => moveBlocker(board, move) === null);
}

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function validateMove(board: Board, color: WireColor, uci: unknown): { ok: true; move: Move } | Rejection {
  const match = typeof uci === 'string' ? UCI.exec(uci) : null;
  if (match === null) return { ok: false, code: 'illegal_move' };
  const from = match[1] as Square;
  const to = match[2] as Square;
  const promotion = match[3];

  const piece = board.pieces.at(from);
  if (piece === undefined || piece.color !== color) return { ok: false, code: 'illegal_move' };
  if (board.pieces.hasStatus(from, 'freeze')) return { ok: false, code: 'piece_frozen' };

  const move = board.chess
    .moves({ square: from, verbose: true })
    .find((candidate) => candidate.to === to && candidate.promotion === promotion);
  if (move === undefined) return { ok: false, code: 'illegal_move' };

  const blocker = moveBlocker(board, move);
  return blocker === null ? { ok: true, move } : { ok: false, code: blocker };
}

/** M2: caselle vuote raggiungibili con una mossa "tranquilla" legale del pezzo, come se toccasse a `color`. */
export function teleportDestinations(board: Board, color: WireColor, from: Square): Square[] {
  const fields = board.chess.fen().split(' ');
  fields[1] = toChessColor(color);
  fields[3] = '-';
  const probe = new Chess(fields.join(' '), { skipValidation: true });
  return probe
    .moves({ square: from, verbose: true })
    .filter((m) => !m.isCapture() && !m.isEnPassant() && !m.isPromotion() && !m.isKingsideCastle() && !m.isQueensideCastle())
    .map((m) => m.to);
}

export type Outcome = { reason: 'checkmate' | 'stalemate' | 'draw'; winner: WireColor | null };

/** Esito scacchistico immediato dopo una mossa (regole standard). */
export function chessOutcome(chess: Chess): Outcome | null {
  const toMove: WireColor = chess.turn() === 'w' ? 'white' : 'black';
  if (chess.isCheckmate()) return { reason: 'checkmate', winner: other(toMove) };
  if (chess.isStalemate()) return { reason: 'stalemate', winner: null };
  if (chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves()) return { reason: 'draw', winner: null };
  return null;
}

/** M7: all'ingresso in fase `move`, nessuna mossa disponibile per via dei filtri. */
export function blockedOutcome(board: Board, color: WireColor): Outcome | null {
  if (filteredMoves(board, color).length > 0) return null;
  return inCheck(board.chess, color) ? { reason: 'checkmate', winner: other(color) } : { reason: 'stalemate', winner: null };
}

// ---------------------------------------------------------------------------------------------------
// Risoluzione delle magie
// ---------------------------------------------------------------------------------------------------

export interface CastResolution {
  ok: true;
  board: Board;
  applied: WireAppliedEffect[];
  statuses: { pieceId: string; kind: StatusKind; turns: number }[];
  draws: number;
  manaGain: number;
  boardChanged: boolean;
}

interface EffectContext {
  board: Board;
  caster: WireColor;
  primary: Square | null;
  targets: readonly Square[];
  params: Record<string, unknown>;
  result: CastResolution;
}

interface EffectHandler {
  /** Bersagli aggiuntivi oltre al primario (es. la destinazione di Teleport). */
  extraTargets: number;
  apply(ctx: EffectContext): ErrorCode | null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function statusHandler(kind: StatusKind): EffectHandler {
  return {
    extraTargets: 0,
    apply({ board, primary, params, result }) {
      const turns = positiveInt(params['turns']);
      if (primary === null || turns === null) return 'invalid_target';
      const piece = board.pieces.setStatus(primary, kind, turns);
      if (piece === undefined) return 'invalid_target';
      result.statuses.push({ pieceId: piece.id, kind, turns });
      result.applied.push({ kind: `${kind}_piece`, piece_id: piece.id, square: primary, params: { turns } });
      return null;
    },
  };
}

// Registry del mock: il "server" conosce gli effetti; il client no (lui usa il proprio registry di rendering).
const EFFECT_HANDLERS: Readonly<Record<string, EffectHandler>> = {
  destroy_piece: {
    extraTargets: 0,
    apply({ board, primary, result }) {
      if (primary === null) return 'invalid_target';
      const piece = board.pieces.at(primary);
      if (piece === undefined || piece.type === 'k') return 'invalid_target'; // M3
      board.chess.remove(primary);
      board.pieces.remove(primary);
      result.applied.push({ kind: 'destroy_piece', piece_id: piece.id, square: primary, params: {} });
      result.boardChanged = true;
      return null;
    },
  },
  move_piece: {
    extraTargets: 1,
    apply({ board, caster, primary, targets, result }) {
      const destination = targets[1];
      if (primary === null || destination === undefined) return 'invalid_target';
      const piece = board.pieces.at(primary);
      const chessPiece = board.chess.get(primary);
      if (piece === undefined || chessPiece === undefined) return 'invalid_target';
      if (board.pieces.hasStatus(primary, 'freeze')) return 'piece_frozen';
      if (!teleportDestinations(board, caster, primary).includes(destination)) return 'invalid_target'; // M2
      board.chess.remove(primary);
      board.chess.put(chessPiece, destination);
      board.pieces.relocate(primary, destination);
      result.applied.push({ kind: 'move_piece', piece_id: piece.id, square: destination, params: { from: primary, to: destination } });
      result.boardChanged = true;
      return null;
    },
  },
  freeze_piece: statusHandler('freeze'),
  shield_piece: statusHandler('shield'),
  draw_card: {
    extraTargets: 0,
    apply({ params, result }) {
      const amount = positiveInt(params['amount']);
      if (amount === null) return 'invalid_target';
      result.draws += amount;
      result.applied.push({ kind: 'draw_card', params: { amount } });
      return null;
    },
  },
  gain_mana: {
    extraTargets: 0,
    apply({ params, result }) {
      const amount = positiveInt(params['amount']);
      if (amount === null) return 'invalid_target';
      result.manaGain += amount;
      result.applied.push({ kind: 'gain_mana', params: { amount } });
      return null;
    },
  },
};

function validatePrimaryTarget(board: Board, caster: WireColor, spell: MockSpell, square: Square): ErrorCode | null {
  const piece = board.pieces.at(square);
  switch (spell.target_type) {
    case 'none':
    case 'square':
      return null;
    case 'piece':
      if (piece === undefined) return 'invalid_target';
      return piece.color !== caster && board.pieces.hasStatus(square, 'shield') ? 'target_shielded' : null;
    case 'own_piece':
      return piece !== undefined && piece.color === caster ? null : 'invalid_target';
    case 'enemy_piece':
      if (piece === undefined || piece.color === caster) return 'invalid_target';
      return board.pieces.hasStatus(square, 'shield') ? 'target_shielded' : null; // M1
  }
}

/**
 * Risolve una magia su una copia della scacchiera. Non tocca `board`: il chiamante applica il risultato
 * solo se `ok`. Fase, mana e presenza in mano sono verificati dal room prima di chiamare questa funzione.
 */
export function resolveCast(board: Board, caster: WireColor, spell: MockSpell, rawTargets: unknown): CastResolution | Rejection {
  if (!Array.isArray(rawTargets) || !rawTargets.every(isSquare)) return { ok: false, code: 'invalid_target' };
  const targets: Square[] = rawTargets;

  const handlers: { handler: EffectHandler; params: Record<string, unknown> }[] = [];
  for (const effect of spell.effects) {
    const handler = EFFECT_HANDLERS[effect.kind];
    if (handler === undefined) return { ok: false, code: 'unknown_spell' };
    handlers.push({ handler, params: effect.params });
  }

  const expected =
    (spell.target_type === 'none' ? 0 : 1) + handlers.reduce((sum, { handler }) => sum + handler.extraTargets, 0);
  if (targets.length !== expected) return { ok: false, code: 'invalid_target' };

  const primary = spell.target_type === 'none' ? null : (targets[0] ?? null);
  if (primary !== null) {
    const code = validatePrimaryTarget(board, caster, spell, primary);
    if (code !== null) return { ok: false, code };
  }

  const casterWasInCheck = inCheck(board.chess, caster);
  const result: CastResolution = {
    ok: true,
    board: cloneBoard(board),
    applied: [],
    statuses: [],
    draws: 0,
    manaGain: 0,
    boardChanged: false,
  };
  for (const { handler, params } of handlers) {
    const code = handler.apply({ board: result.board, caster, primary, targets, params, result });
    if (code !== null) return { ok: false, code };
  }

  if (result.boardChanged) {
    // M4: la posizione deve restare legale: chi non ha il tratto non può essere sotto scacco,
    // e chi lancia non può mettersi da solo sotto scacco.
    const notToMove: WireColor = result.board.chess.turn() === 'w' ? 'black' : 'white';
    if (inCheck(result.board.chess, notToMove)) return { ok: false, code: 'invalid_target' };
    if (!casterWasInCheck && inCheck(result.board.chess, caster)) return { ok: false, code: 'invalid_target' };
  }
  return result;
}
