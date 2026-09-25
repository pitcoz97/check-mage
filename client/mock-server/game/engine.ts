import { Chess } from 'chess.js';

/**
 * Sostituto di `engine/stockfish.go` basato su chess.js, con la stessa interfaccia FEN-based.
 * Le regole di patta sono quelle del server, non quelle di chess.js (ASSUMPTIONS C6).
 */

export type GameStatus = 'ongoing' | 'checkmate' | 'stalemate' | 'draw';

function load(fen: string): Chess {
  return new Chess(fen, { skipValidation: true });
}

/** `stockfish.go:116-139`: la mossa UCI compare tra quelle legali (perft 1). */
export function isMoveLegal(fen: string, move: string): boolean {
  try {
    return load(fen)
      .moves({ verbose: true })
      .some((m) => m.lan === move);
  } catch {
    return false;
  }
}

/** Mosse legali in UCI (usato solo dai bot del mock). */
export function legalMoves(fen: string): string[] {
  try {
    return load(fen)
      .moves({ verbose: true })
      .map((m) => m.lan);
  } catch {
    return [];
  }
}

/** `stockfish.go:294-313`. */
export function applyMove(fen: string, move: string): string {
  try {
    const chess = load(fen);
    const promotion = move.length >= 5 ? move[4] : undefined;
    chess.move(promotion === undefined ? { from: move.slice(0, 2), to: move.slice(2, 4) } : { from: move.slice(0, 2), to: move.slice(2, 4), promotion });
    return chess.fen();
  } catch {
    return fen;
  }
}

/** `stockfish.go:181-186,236-252`: il lato al tratto è sotto scacco. */
export function isInCheck(fen: string): boolean {
  try {
    return load(fen).inCheck();
  } catch {
    return false;
  }
}

/** `stockfish.go:188-232`. */
export function getGameStatus(fen: string): GameStatus {
  let chess: Chess;
  try {
    chess = load(fen);
  } catch {
    return 'ongoing';
  }
  if (chess.moves().length === 0) return chess.inCheck() ? 'checkmate' : 'stalemate';
  if (isDrawByRule(fen)) return 'draw';
  return 'ongoing';
}

/** `stockfish.go:258-277`: 50 mosse o materiale insufficiente. */
function isDrawByRule(fen: string): boolean {
  const f = fen.trim().split(/\s+/);
  const half = Number(f[4]);
  if (Number.isInteger(half) && half >= 100) return true;
  return insufficientMaterial(f[0] ?? '');
}

/** `stockfish.go:279-292`: volutamente conservativa (solo re contro re, o re + un pezzo minore). */
function insufficientMaterial(placement: string): boolean {
  let minors = 0;
  for (const ch of placement) {
    if ('pPrRqQ'.includes(ch)) return false;
    if ('bBnN'.includes(ch)) minors++;
  }
  return minors <= 1;
}
