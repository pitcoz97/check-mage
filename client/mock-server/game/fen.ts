import { WS, type ServerText } from '../serverTexts';

/**
 * Porting di `effects/effects.go`: manipolazione della FEN come stringa, senza motore.
 * Gli errori sono i testi esatti del server.
 */

export type Color = 'white' | 'black';
export type Grid = (string | null)[][];

export class EffectError extends Error {
  constructor(readonly text: ServerText) {
    super(text.message);
  }
}

/** `effects.go:23-35`: riga 0 = traversa 8. */
export function parseSquare(square: string): [row: number, col: number] {
  if (square.length !== 2) throw new EffectError(WS.invalidSquare(square));
  const file = square.charCodeAt(0);
  const rank = square.charCodeAt(1);
  if (file < 97 || file > 104 || rank < 49 || rank > 56) throw new EffectError(WS.offBoardSquare(square));
  return [56 - rank, file - 97];
}

export function squareName(row: number, col: number): string {
  return String.fromCharCode(97 + col) + String.fromCharCode(56 - row);
}

/** `effects.go:38-73`. */
export function parsePlacement(fen: string): Grid {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`FEN malformata: ${ranks.length} traverse`);
  return ranks.map((rank) => {
    const row: (string | null)[] = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') for (let k = 0; k < Number(ch); k++) row.push(null);
      else row.push(ch);
    }
    if (row.length !== 8) throw new Error(`traversa non valida: ${rank}`);
    return row;
  });
}

/** `effects.go:76-98`. */
export function encodePlacement(grid: Grid): string {
  return grid
    .map((row) => {
      let out = '';
      let empty = 0;
      for (const cell of row) {
        if (cell === null) {
          empty++;
          continue;
        }
        if (empty > 0) out += String(empty);
        empty = 0;
        out += cell;
      }
      return empty > 0 ? out + String(empty) : out;
    })
    .join('/');
}

function fields(fen: string): string[] {
  return fen.trim().split(/\s+/);
}

function replacePlacement(fen: string, placement: string): string {
  const f = fields(fen);
  f[0] = placement;
  return f.join(' ');
}

export function pieceColor(piece: string): Color {
  return piece >= 'A' && piece <= 'Z' ? 'white' : 'black';
}

/** `effects.go:117-133`. */
export function pieceName(piece: string): string {
  const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  return names[piece.toLowerCase()] ?? 'unknown';
}

export function pieceAt(fen: string, square: string): string | null {
  const [row, col] = parseSquare(square);
  return parsePlacement(fen)[row]?.[col] ?? null;
}

/** `effects.go:139-160`: mossa nulla (usata quando lo scudo assorbe una cattura). */
export function passTurn(fen: string): string {
  const f = fields(fen);
  if (f.length < 6) return fen;
  f[1] = f[1] === 'w' ? 'b' : 'w';
  f[3] = '-';
  const half = Number(f[4]);
  if (Number.isInteger(half)) f[4] = String(half + 1);
  if (f[1] === 'w') {
    const full = Number(f[5]);
    if (Number.isInteger(full)) f[5] = String(full + 1);
  }
  return f.join(' ');
}

/** `effects.go:179-207`. */
export function destroyPiece(fen: string, square: string, caster: Color): { fen: string; destroyed: string } {
  const [row, col] = parseSquare(square);
  const grid = parsePlacement(fen);
  const piece = grid[row]?.[col] ?? null;
  if (piece === null) throw new EffectError(WS.nothingToDestroy(square));
  if (pieceColor(piece) === caster) throw new EffectError(WS.cannotDestroyOwn(square));
  if (piece === 'k' || piece === 'K') throw new EffectError(WS.kingIndestructible);
  (grid[row] as (string | null)[])[col] = null;
  const next = clearCastlingForRook(replacePlacement(fen, encodePlacement(grid)), square, piece);
  return { fen: next, destroyed: pieceName(piece) };
}

/** `effects.go:214-242`. */
export function movePieceFen(fen: string, from: string, to: string, caster: Color): string {
  const [fr, fc] = parseSquare(from);
  const [tr, tc] = parseSquare(to);
  const grid = parsePlacement(fen);
  const piece = grid[fr]?.[fc] ?? null;
  if (piece === null) throw new EffectError(WS.nothingToMove(from));
  if (pieceColor(piece) !== caster) throw new EffectError(WS.moveOnlyOwn(from));
  if ((grid[tr]?.[tc] ?? null) !== null) throw new EffectError(WS.destinationOccupied(to));
  (grid[tr] as (string | null)[])[tc] = piece;
  (grid[fr] as (string | null)[])[fc] = null;
  return clearCastlingForMovedPiece(replacePlacement(fen, encodePlacement(grid)), from, piece);
}

/** `effects.go:247-258`. */
export function withSideToMove(fen: string, color: Color): string {
  const f = fields(fen);
  if (f.length < 2) return fen;
  f[1] = color === 'white' ? 'w' : 'b';
  return f.join(' ');
}

export function sideToMove(fen: string): Color {
  return fields(fen)[1] === 'b' ? 'black' : 'white';
}

function clearCastling(fen: string, rights: string): string {
  const f = fields(fen);
  if (f.length < 3 || f[2] === '-') return fen;
  let c = f[2] as string;
  for (const r of rights) c = c.replaceAll(r, '');
  f[2] = c === '' ? '-' : c;
  return f.join(' ');
}

/** `effects.go:262-272`. */
function clearCastlingForMovedPiece(fen: string, from: string, piece: string): string {
  if (piece === 'K') return clearCastling(fen, 'KQ');
  if (piece === 'k') return clearCastling(fen, 'kq');
  if (piece === 'R' || piece === 'r') return clearCastlingForRook(fen, from, piece);
  return fen;
}

/** `effects.go:293-318`. */
function clearCastlingForRook(fen: string, square: string, piece: string): string {
  const right =
    piece === 'R' && square === 'a1'
      ? 'Q'
      : piece === 'R' && square === 'h1'
        ? 'K'
        : piece === 'r' && square === 'a8'
          ? 'q'
          : piece === 'r' && square === 'h8'
            ? 'k'
            : null;
  return right === null ? fen : clearCastling(fen, right);
}
