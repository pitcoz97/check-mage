import { Chess, type Square as ChessSquare } from 'chess.js';

import type { PieceKind, Square, UciMove } from './model';

export { isLightSquare, piecesOf, squaresInOrder, type PlacedPiece } from './fen';

/**
 * Derivazioni dalla FEN per il rendering e per gli **spunti visivi** sulle mosse.
 *
 * chess.js non è mai l'autorità (CLAUDE.md): decide solo cosa evidenziare. Le mosse le valida il server, che può
 * rifiutare ciò che qui sembra legale (pezzo congelato, partita finita) e accettare ciò che qui manca.
 * Le posizioni prodotte dalle magie possono non essere legali per il motore: si carica sempre con `skipValidation`.
 */

/** Lettera UCI della promozione, nell'ordine in cui la UI le propone. */
export const PROMOTION_CHOICES: readonly { readonly kind: PieceKind; readonly letter: string }[] = [
  { kind: 'queen', letter: 'q' },
  { kind: 'rook', letter: 'r' },
  { kind: 'bishop', letter: 'b' },
  { kind: 'knight', letter: 'n' },
];

function load(fen: string): Chess | null {
  try {
    return new Chess(fen, { skipValidation: true });
  } catch {
    return null;
  }
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
