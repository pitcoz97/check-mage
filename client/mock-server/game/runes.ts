import { parseSquare, pieceAt, pieceName, squareName } from './fen';
import type { RuneSpec } from './tracker';

/**
 * Porting della parte pura di `effects/runes.go`: quale pezzo entra in una casa, cosa gli fa una runa e le case
 * attorno a una runa. Le rune vivono nel Tracker (`addRune`, `runeAt`, `squareEffectsFor`).
 */

export const RUNE_FREEZE = 'freeze_piece';
export const RUNE_RETURN = 'return_to_origin';
export const RUNE_DESTROY = 'destroy_piece';

/**
 * `RuneEntry`: casa d'arrivo, casa di partenza e pezzo (com'era prima di muovere) di una mossa già legale, sulla FEN
 * prima della mossa. Il re non fa scattare le rune: nell'arrocco entra la torre. `null` se non entra nessuno.
 */
export function runeEntry(fen: string, move: string): { square: string; origin: string; piece: string } | null {
  if (move.length < 4) return null;
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  const piece = pieceAt(fen, from);
  if (piece === null) return null;
  if (piece !== 'k' && piece !== 'K') return { square: to, origin: from, piece };
  const rooks: Record<string, [string, string]> = { e1g1: ['h1', 'f1'], e1c1: ['a1', 'd1'], e8g8: ['h8', 'f8'], e8c8: ['a8', 'd8'] };
  const pair = rooks[from + to];
  if (pair === undefined) return null;
  const rook = pieceAt(fen, pair[0]);
  return rook === null ? null : { square: pair[1], origin: pair[0], piece: rook };
}

/** `RuneSpec.Strike`: `on_enter` se il tipo è ammesso (`only` vuoto = tutti), altrimenti il fallback. */
export function runeStrike(spec: RuneSpec, piece: string): { kind: string; duration: number } {
  if (spec.only === undefined || spec.only.length === 0 || spec.only.includes(pieceName(piece))) {
    return { kind: spec.on_enter, duration: spec.duration ?? 0 };
  }
  return { kind: spec.fallback ?? '', duration: spec.fallback_duration ?? 0 };
}

/** `AroundSquares`: le case entro la distanza di Chebyshev, casa esclusa, in ordine. */
export function aroundSquares(square: string, radius: number): string[] {
  const [row, col] = parseSquare(square);
  const out: string[] = [];
  for (let r = row - radius; r <= row + radius; r++) {
    for (let c = col - radius; c <= col + radius; c++) {
      if (r < 0 || r > 7 || c < 0 || c > 7 || (r === row && c === col)) continue;
      out.push(squareName(r, c));
    }
  }
  return out.sort();
}
