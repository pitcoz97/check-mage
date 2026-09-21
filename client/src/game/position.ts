import { Chess, type Color as ChessColor, type PieceSymbol, type Square as ChessSquare } from 'chess.js';

import type { Color, PieceKind, Square, UciMove } from './model';

/**
 * Derivazioni dalla FEN per il rendering e per gli **spunti visivi** sulle mosse.
 *
 * chess.js non è mai l'autorità (CLAUDE.md): decide solo cosa evidenziare. Le mosse le valida il server, che può
 * rifiutare ciò che qui sembra legale (pezzo congelato, partita finita) e accettare ciò che qui manca.
 * Le posizioni prodotte dalle magie possono non essere legali per il motore: si carica sempre con `skipValidation`.
 */

const KIND_OF: Record<PieceSymbol, PieceKind> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const COLOR_OF: Record<ChessColor, Color> = { w: 'white', b: 'black' };

/** Lettera UCI della promozione, nell'ordine in cui la UI le propone. */
export const PROMOTION_CHOICES: readonly { readonly kind: PieceKind; readonly letter: string }[] = [
  { kind: 'queen', letter: 'q' },
  { kind: 'rook', letter: 'r' },
  { kind: 'bishop', letter: 'b' },
  { kind: 'knight', letter: 'n' },
];

export interface PlacedPiece {
  readonly square: Square;
  readonly color: Color;
  readonly kind: PieceKind;
}

function load(fen: string): Chess | null {
  try {
    return new Chess(fen, { skipValidation: true });
  } catch {
    return null;
  }
}

/** I pezzi sulla scacchiera, per il rendering. FEN illeggibile → nessun pezzo (la UI resta vuota, non esplode). */
export function piecesOf(fen: string): PlacedPiece[] {
  const chess = load(fen);
  if (chess === null) return [];
  const pieces: PlacedPiece[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell === null) continue;
      pieces.push({ square: cell.square as Square, color: COLOR_OF[cell.color], kind: KIND_OF[cell.type] });
    }
  }
  return pieces;
}

/** Caselle d'arrivo legali da `from`, solo per evidenziarle. */
export function legalTargets(fen: string, from: Square): Square[] {
  const chess = load(fen);
  if (chess === null) return [];
  try {
    const moves = chess.moves({ square: from as ChessSquare, verbose: true });
    return [...new Set(moves.map((m) => m.to as Square))];
  } catch {
    return [];
  }
}

/** `true` se la mossa richiede di scegliere il pezzo di promozione. */
export function needsPromotion(fen: string, from: Square, to: Square): boolean {
  const chess = load(fen);
  if (chess === null) return false;
  try {
    return chess.moves({ square: from as ChessSquare, verbose: true }).some((m) => m.to === to && m.promotion !== undefined);
  } catch {
    return false;
  }
}

/** Casella del re sotto scacco (quello del lato al tratto), da evidenziare. */
export function kingInCheckSquare(fen: string): Square | null {
  const chess = load(fen);
  if (chess === null || !chess.inCheck()) return null;
  const king = chess.findPiece({ type: 'k', color: chess.turn() })[0];
  return (king as Square | undefined) ?? null;
}

/** Mossa in notazione UCI, come la vuole il server (`game/room.go:423`). */
export function toUci(from: Square, to: Square, promotion?: string): UciMove {
  return `${from}${to}${promotion ?? ''}`;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

/** Caselle nell'ordine di rendering: il proprio lato sta sempre in basso. */
export function squaresInOrder(orientation: Color): Square[] {
  const files = orientation === 'white' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'white' ? RANKS : [...RANKS].reverse();
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as Square));
}

export function isLightSquare(square: Square): boolean {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0;
}
