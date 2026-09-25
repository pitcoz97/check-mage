import type { SquareEffects, Square } from '../model';
import { piecesOf } from '../position';

/**
 * Stati delle case che tolgono mosse (`effects/squares.go`, MoveBlock): serve solo a non evidenziare mosse che il
 * server rifiuterebbe con `move_blocked`, come si fa già per i pezzi congelati (ASSUMPTIONS M27). Il server resta
 * l'autorità: se il client sbaglia, arriva il rifiuto e il rollback.
 *
 * Il muro blocca l'arrivo e le case attraversate (torre, alfiere e donna; spinta doppia del pedone; arrocco fino alla
 * torre); il cavallo scavalca. Il santuario vieta la cattura del pezzo che ci sta sopra, en passant compreso.
 */

const WALL = 'wall';
const NO_CAPTURE = 'no_capture';

function has(states: readonly SquareEffects[], square: Square, kind: string): boolean {
  return states.some((entry) => entry.square === square && entry.effects.some((effect) => effect.kind === kind));
}

function at(file: number, rank: number): Square {
  return `${String.fromCharCode(97 + file)}${rank + 1}` as Square;
}

/** `true` se muri o santuari vietano la mossa (già legale per gli scacchi) da `from` a `to`. */
export function blockedMove(fen: string, states: readonly SquareEffects[], from: Square, to: Square): boolean {
  if (states.length === 0) return false;
  const pieces = piecesOf(fen);
  const mover = pieces.find((piece) => piece.square === from);
  if (mover === undefined) return false;
  if (has(states, to, WALL)) return true;

  const [ff, fr] = [from.charCodeAt(0) - 97, Number(from[1]) - 1];
  const [tf, tr] = [to.charCodeAt(0) - 97, Number(to[1]) - 1];
  const df = Math.sign(tf - ff);
  const dr = Math.sign(tr - fr);
  const crossed: Square[] = [];
  if (mover.kind === 'king' && Math.abs(tf - ff) === 2) {
    const rookFile = df > 0 ? 7 : 0;
    for (let f = ff + df; f !== rookFile; f += df) crossed.push(at(f, fr));
  } else if (mover.kind === 'pawn' && Math.abs(tr - fr) === 2) {
    crossed.push(at(ff, fr + dr));
  } else if (
    (mover.kind === 'rook' || mover.kind === 'bishop' || mover.kind === 'queen') &&
    (ff === tf || fr === tr || Math.abs(tf - ff) === Math.abs(tr - fr))
  ) {
    for (let f = ff + df, r = fr + dr; f !== tf || r !== tr; f += df, r += dr) crossed.push(at(f, r));
  }
  if (crossed.some((square) => has(states, square, WALL))) return true;

  const occupied = pieces.some((piece) => piece.square === to);
  const enPassant = !occupied && mover.kind === 'pawn' && ff !== tf;
  const captured = occupied ? to : enPassant ? at(tf, fr) : null;
  return captured !== null && has(states, captured, NO_CAPTURE);
}
