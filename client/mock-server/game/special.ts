import { applySpecialMove, isKingAttacked, parsePlacement, pieceColor, sideToMove, squareName } from './fen';
import { KIND_NO_CAPTURE, KIND_WALL } from './squares';
import type { Tracker } from './tracker';

/**
 * Porting di `effects/special.go` (Step 6): le mosse che Stockfish non conosce. Phasing (un alfiere che attraversa i
 * pezzi), movimento preso in prestito (un pedone che muove anche da cavallo o alfiere), passo di lato dello Stendardo.
 */

export const KIND_PHASING = 'phasing';
export const KIND_BORROW = 'borrow_movement';

const DIAGONALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const KNIGHT_JUMPS: readonly (readonly [number, number])[] = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];

const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

/** `SpecialMoves`: le mosse speciali del lato al tratto, già valide (M54–M59), in ordine. */
export function specialMoves(fen: string, tracker: Tracker, sidestep: boolean): string[] {
  let grid;
  try {
    grid = parsePlacement(fen);
  } catch {
    return [];
  }
  const side = sideToMove(fen);
  const out = new Set<string>();
  const add = (from: string, to: string) => {
    const move = from + to;
    if (out.has(move)) return;
    const next = applySpecialMove(fen, move);
    if (next !== null && !isKingAttacked(next, side)) out.add(move);
  };
  // Mai sul muro, mai su un proprio pezzo o sul re; una cattura solo se ammessa e non su un santuario.
  const target = (r: number, c: number, canCapture: boolean): boolean => {
    const sq = squareName(r, c);
    if (tracker.hasSquareEffect(sq, KIND_WALL)) return false;
    const p = grid[r]?.[c] ?? null;
    if (p === null) return true;
    if (!canCapture || pieceColor(p) === side || p.toLowerCase() === 'k') return false;
    return !tracker.hasSquareEffect(sq, KIND_NO_CAPTURE);
  };

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = grid[row]?.[col] ?? null;
      if (p === null || pieceColor(p) !== side) continue;
      const from = squareName(row, col);
      if (tracker.isFrozen(from)) continue;
      const kind = p.toLowerCase();
      if (kind === 'b' && tracker.hasEffect(from, KIND_PHASING)) {
        // Phasing: attraverso i pezzi fino a una casa vuota; il muro ferma (M54).
        for (const [dr, dc] of DIAGONALS) {
          for (let r = row + dr, c = col + dc; inside(r, c); r += dr, c += dc) {
            if (tracker.hasSquareEffect(squareName(r, c), KIND_WALL)) break;
            if ((grid[r]?.[c] ?? null) === null) add(from, squareName(r, c));
          }
        }
      } else if (kind === 'p') {
        // Movimento preso in prestito: mai in 1ª o 8ª traversa (M56).
        const okRank = (r: number) => r !== 0 && r !== 7;
        const borrowed = tracker.borrowedAs(from);
        if (borrowed === 'knight') {
          for (const [dr, dc] of KNIGHT_JUMPS) {
            const r = row + dr;
            const c = col + dc;
            if (inside(r, c) && okRank(r) && target(r, c, true)) add(from, squareName(r, c));
          }
        } else if (borrowed === 'bishop') {
          for (const [dr, dc] of DIAGONALS) {
            for (let r = row + dr, c = col + dc; inside(r, c); r += dr, c += dc) {
              if (tracker.hasSquareEffect(squareName(r, c), KIND_WALL)) break;
              if (okRank(r) && target(r, c, true)) add(from, squareName(r, c));
              if ((grid[r]?.[c] ?? null) !== null) break;
            }
          }
        }
        // Passo di lato dello Stendardo: una casa vuota accanto, senza cattura (M58).
        if (sidestep) {
          for (const dc of [-1, 1]) {
            if (inside(row, col + dc) && target(row, col + dc, false)) add(from, squareName(row, col + dc));
          }
        }
      }
    }
  }
  return [...out].sort();
}
