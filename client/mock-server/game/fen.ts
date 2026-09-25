import { WS, type GameError } from '../serverTexts';

/**
 * Porting di `effects/effects.go`: manipolazione della FEN come stringa, senza motore.
 * Gli errori sono quelli esatti del server (codice `invalid_target`, `gameerr/gameerr.go:37`).
 */

export type Color = 'white' | 'black';
export type Grid = (string | null)[][];

export class EffectError extends Error {
  constructor(readonly error: GameError) {
    super(error.message);
  }
}

/** `effects.go:25-37`: riga 0 = traversa 8. */
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

/** `effects.go:40-75`. */
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

/** `effects.go:78-102`. */
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

/** `effects.go:119-135`. */
export function pieceName(piece: string): string {
  const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  return names[piece.toLowerCase()] ?? 'unknown';
}

export function pieceAt(fen: string, square: string): string | null {
  const [row, col] = parseSquare(square);
  return parsePlacement(fen)[row]?.[col] ?? null;
}

/** `effects.go:141-162`: mossa nulla (usata quando lo scudo assorbe una cattura). */
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

/** `DestroyPiece` (`effects.go`): di chi sia il pezzo lo decide il TargetSpec; il re non si distrugge mai. */
export function destroyPiece(fen: string, square: string): { fen: string; destroyed: string } {
  const [row, col] = parseSquare(square);
  const grid = parsePlacement(fen);
  const piece = grid[row]?.[col] ?? null;
  if (piece === null) throw new EffectError(WS.nothingToDestroy(square));
  if (piece === 'k' || piece === 'K') throw new EffectError(WS.kingIndestructible(square));
  (grid[row] as (string | null)[])[col] = null;
  const next = clearCastlingForRook(replacePlacement(fen, encodePlacement(grid)), square, piece);
  return { fen: next, destroyed: pieceName(piece) };
}

/** `effects.go:216-244`. */
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

/** `RelativeRank`: la traversa vista dal colore (1 = la sua prima); 0 se la casella non è valida. */
export function relativeRank(square: string, color: Color): number {
  const rank = square.length === 2 ? Number(square[1]) : NaN;
  if (!Number.isInteger(rank) || rank < 1 || rank > 8) return 0;
  return color === 'black' ? 9 - rank : rank;
}

/** `ForwardSquare`: la casella `n` passi in avanti per il colore (il Bianco verso la traversa 8). */
export function forwardSquare(square: string, color: Color, n: number): string {
  const [row, col] = parseSquare(square);
  const next = color === 'white' ? row - n : row + n;
  if (next < 0 || next > 7) throw new EffectError(WS.cannotAdvance(square, n));
  return squareName(next, col);
}

/** `PlacePiece`: mette il pezzo su una casella vuota. */
export function placePiece(fen: string, square: string, piece: string): string {
  const [row, col] = parseSquare(square);
  const grid = parsePlacement(fen);
  if ((grid[row]?.[col] ?? null) !== null) throw new EffectError(WS.squareNotEmpty(square));
  (grid[row] as (string | null)[])[col] = piece;
  return replacePlacement(fen, encodePlacement(grid));
}

/** `CountPieces`: pezzi uguali al carattere FEN dato. */
export function countPieces(fen: string, piece: string): number {
  return parsePlacement(fen)
    .flat()
    .filter((cell) => cell === piece).length;
}

/**
 * `ClearStaleEnPassant`: azzera la casella en passant se il pedone che l'ha creata non c'è più o se la casella di
 * passaggio non è vuota.
 */
export function clearStaleEnPassant(fen: string): string {
  const f = fields(fen);
  const ep = f[3];
  if (ep === undefined || ep === '-' || ep.length !== 2) return fen;
  const grid = parsePlacement(fen);
  const [row, col] = parseSquare(ep);
  const [pawnRow, pawn] = ep[1] === '3' ? [row - 1, 'P'] : ep[1] === '6' ? [row + 1, 'p'] : [-1, ''];
  if (pawnRow >= 0 && grid[row]?.[col] === null && grid[pawnRow]?.[col] === pawn) return fen;
  f[3] = '-';
  return f.join(' ');
}

/** `PieceLetter` (`effects/group_a.go`): carattere FEN del pezzo nel colore dato, `null` se il nome è ignoto. */
export function pieceLetter(kind: string, color: Color): string | null {
  const letters: Record<string, string> = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
  const letter = letters[kind];
  if (letter === undefined) return null;
  return color === 'white' ? letter.toUpperCase() : letter;
}

/** `SwapPieces` (`effects/group_a.go`): nessun pedone sulla 1ª o sull'8ª traversa; torri e re perdono l'arrocco. */
export function swapPieces(fen: string, a: string, b: string): string {
  const [ar, ac] = parseSquare(a);
  const [br, bc] = parseSquare(b);
  const grid = parsePlacement(fen);
  const pa = grid[ar]?.[ac] ?? null;
  const pb = grid[br]?.[bc] ?? null;
  if (pa === null || pb === null) throw new EffectError(WS.swapNeedsTwo(a, b));
  if ((pa === 'P' || pa === 'p') && (br === 0 || br === 7)) throw new EffectError(WS.pawnRank(1, b));
  if ((pb === 'P' || pb === 'p') && (ar === 0 || ar === 7)) throw new EffectError(WS.pawnRank(0, a));
  (grid[ar] as (string | null)[])[ac] = pb;
  (grid[br] as (string | null)[])[bc] = pa;
  let next = replacePlacement(fen, encodePlacement(grid));
  next = clearCastlingForMovedPiece(next, a, pa);
  return clearCastlingForMovedPiece(next, b, pb);
}

/** `SetPiece` (`effects/group_a.go`): cambia il pezzo di una casa occupata. */
export function setPiece(fen: string, square: string, piece: string): string {
  const [row, col] = parseSquare(square);
  const grid = parsePlacement(fen);
  const old = grid[row]?.[col] ?? null;
  if (old === null) throw new EffectError(WS.nothingAtTarget(square));
  (grid[row] as (string | null)[])[col] = piece;
  const next = replacePlacement(fen, encodePlacement(grid));
  return old === 'R' || old === 'r' ? clearCastlingForRook(next, square, old) : next;
}

/** `RestoreCastling` (`effects/group_a.go`): diritti dove re e torre sono sulle case iniziali; `null` se nulla cambia. */
export function restoreCastling(fen: string, color: Color): string | null {
  const grid = parsePlacement(fen);
  const f = fields(fen);
  if (f.length < 3) return null;
  const row = color === 'white' ? 7 : 0;
  const [king, rook, short, long] = color === 'white' ? ['K', 'R', 'K', 'Q'] : ['k', 'r', 'k', 'q'];
  let rights = f[2] === '-' ? '' : (f[2] as string);
  let added = false;
  if (grid[row]?.[4] === king) {
    if (grid[row]?.[7] === rook && !rights.includes(short)) {
      rights += short;
      added = true;
    }
    if (grid[row]?.[0] === rook && !rights.includes(long)) {
      rights += long;
      added = true;
    }
  }
  if (!added) return null;
  f[2] = [...'KQkq'].filter((r) => rights.includes(r)).join('');
  return f.join(' ');
}

/** `PiecesOf` (`effects/group_a.go`): case dei pezzi del colore coi tipi dati (vuoto = tutti tranne il re). */
export function piecesOf(fen: string, color: Color, kinds: readonly string[]): string[] {
  const out: string[] = [];
  parsePlacement(fen).forEach((row, r) =>
    row.forEach((p, c) => {
      if (p === null || pieceColor(p) !== color) return;
      const name = pieceName(p);
      if (kinds.length === 0 ? name === 'king' : !kinds.includes(name)) return;
      out.push(squareName(r, c));
    }),
  );
  return out;
}

/** `AroundKing` (`effects/group_a.go`): pezzi propri entro il raggio dal proprio re, re escluso. */
export function aroundKing(fen: string, color: Color, radius: number): string[] {
  const grid = parsePlacement(fen);
  const king = color === 'white' ? 'K' : 'k';
  let kr = -1;
  let kc = -1;
  grid.forEach((row, r) =>
    row.forEach((p, c) => {
      if (p === king) [kr, kc] = [r, c];
    }),
  );
  if (kr < 0) return [];
  const out: string[] = [];
  grid.forEach((row, r) =>
    row.forEach((p, c) => {
      if (p === null || p === king || pieceColor(p) !== color) return;
      if (Math.abs(r - kr) <= radius && Math.abs(c - kc) <= radius) out.push(squareName(r, c));
    }),
  );
  return out;
}

/** `PawnsSideBySide` (`effects/group_a.go`): pedoni propri con un altro pedone accanto sulla stessa traversa. */
export function pawnsSideBySide(fen: string, color: Color): string[] {
  const pawn = color === 'white' ? 'P' : 'p';
  const out: string[] = [];
  parsePlacement(fen).forEach((row, r) =>
    row.forEach((p, c) => {
      if (p === pawn && (row[c - 1] === pawn || row[c + 1] === pawn)) out.push(squareName(r, c));
    }),
  );
  return out;
}

/** `effects.go:249-260`. */
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

/** `effects.go:264-274`. */
function clearCastlingForMovedPiece(fen: string, from: string, piece: string): string {
  if (piece === 'K') return clearCastling(fen, 'KQ');
  if (piece === 'k') return clearCastling(fen, 'kq');
  if (piece === 'R' || piece === 'r') return clearCastlingForRook(fen, from, piece);
  return fen;
}

/** `effects.go:295-320`. */
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

/** `SideToMove` / `Opponent` (`effects/attack.go:8-26`). */
export function opponentOf(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

/**
 * `IsKingAttacked` (`effects/attack.go:28-46`): il re del colore dato è attaccato da un pezzo avversario.
 * Calcolato sulla sola disposizione dei pezzi, senza motore: vale anche per posizioni che il motore rifiuterebbe.
 */
export function isKingAttacked(fen: string, color: Color): boolean {
  let grid: Grid;
  try {
    grid = parsePlacement(fen);
  } catch {
    return false;
  }
  const king = color === 'white' ? 'K' : 'k';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (grid[row]?.[col] === king) return squareAttacked(grid, row, col, opponentOf(color));
    }
  }
  return false;
}

/** `squareAttacked` (`effects/attack.go:50-110`): riga 0 = traversa 8. */
function squareAttacked(grid: Grid, row: number, col: number, by: Color): boolean {
  const piece = (p: string) => (by === 'white' ? p.toUpperCase() : p);
  const at = (r: number, c: number) => (r < 0 || r > 7 || c < 0 || c > 7 ? null : (grid[r]?.[c] ?? null));

  // Pedoni: il bianco avanza verso la riga 0, quindi attacca da row+1.
  const pawnRow = by === 'white' ? row + 1 : row - 1;
  if (at(pawnRow, col - 1) === piece('p') || at(pawnRow, col + 1) === piece('p')) return true;

  const knight: readonly (readonly [number, number])[] = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  if (knight.some(([dr, dc]) => at(row + dr, col + dc) === piece('n'))) return true;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((dr !== 0 || dc !== 0) && at(row + dr, col + dc) === piece('k')) return true;
    }
  }

  const slide = (dr: number, dc: number, a: string, b: string): boolean => {
    for (let r = row + dr, c = col + dc; r >= 0 && r < 8 && c >= 0 && c < 8; r += dr, c += dc) {
      const p = grid[r]?.[c] ?? null;
      if (p !== null) return p === a || p === b;
    }
    return false;
  };
  const orthogonal: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const diagonal: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  if (orthogonal.some(([dr, dc]) => slide(dr, dc, piece('r'), piece('q')))) return true;
  return diagonal.some(([dr, dc]) => slide(dr, dc, piece('b'), piece('q')));
}
