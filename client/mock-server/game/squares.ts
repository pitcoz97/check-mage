import { parseSquare, pieceAt, squareName } from './fen';
import type { Tracker } from './tracker';

/**
 * Porting di `effects/squares.go`: la parte pura degli stati delle case. Gli stati vivono nel Tracker
 * (`addSquareEffect`, `tickSquares`, `squareEffects`); qui ci sono la casa catturata e il filtro delle mosse.
 */

export const KIND_WALL = 'wall';
export const KIND_NO_CAPTURE = 'no_capture';

/** `CaptureSquare`: casa del pezzo catturato, anche per l'en passant; `null` se la mossa non cattura. */
export function captureSquare(fen: string, from: string, to: string): string | null {
  if (pieceAt(fen, to) !== null) return to;
  const mover = pieceAt(fen, from);
  if ((mover === 'P' || mover === 'p') && from[0] !== to[0]) return `${to[0]}${from[1]}`;
  return null;
}

/**
 * `MoveBlock`: se gli stati delle case vietano una mossa già legale, la casa responsabile e il motivo (`wall` o
 * `no_capture`). Il muro blocca l'arrivo e le case attraversate (torre, alfiere e donna; spinta doppia; arrocco fino
 * alla torre); il cavallo scavalca. Il santuario vieta la cattura del pezzo che ci sta sopra, en passant compreso.
 */
export function moveBlock(fen: string, tracker: Tracker, move: string): { square: string; reason: string } | null {
  if (!tracker.hasSquareEffects() || move.length < 4) return null;
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  let fr: number, fc: number, tr: number, tc: number;
  try {
    [fr, fc] = parseSquare(from);
    [tr, tc] = parseSquare(to);
  } catch {
    return null;
  }
  const piece = pieceAt(fen, from);
  if (piece === null) return null;
  if (tracker.hasSquareEffect(to, KIND_WALL)) return { square: to, reason: 'wall' };
  for (const square of crossedSquares(piece, fr, fc, tr, tc)) {
    if (tracker.hasSquareEffect(square, KIND_WALL)) return { square, reason: 'wall' };
  }
  const captured = captureSquare(fen, from, to);
  if (captured !== null && tracker.hasSquareEffect(captured, KIND_NO_CAPTURE)) return { square: captured, reason: 'no_capture' };
  return null;
}

function crossedSquares(piece: string, fr: number, fc: number, tr: number, tc: number): string[] {
  const dr = Math.sign(tr - fr);
  const dc = Math.sign(tc - fc);
  const kind = piece.toLowerCase();
  const out: string[] = [];
  if (kind === 'k' && Math.abs(tc - fc) === 2) {
    const rookCol = dc > 0 ? 7 : 0;
    for (let c = fc + dc; c !== rookCol; c += dc) out.push(squareName(fr, c));
    return out;
  }
  if (kind === 'p') return Math.abs(tr - fr) === 2 ? [squareName(fr + dr, fc)] : [];
  const straight = fr === tr || fc === tc || Math.abs(tr - fr) === Math.abs(tc - fc);
  if ((kind === 'r' || kind === 'b' || kind === 'q') && straight) {
    for (let r = fr + dr, c = fc + dc; r !== tr || c !== tc; r += dr, c += dc) out.push(squareName(r, c));
  }
  return out;
}
