import type { Chess, Move, PieceSymbol, Square } from 'chess.js';

import { opaqueId, type Rng } from '../util';
import type { WireColor, WirePiece } from '../wire';

/** Stati persistenti sui pezzi (ASSUMPTIONS.md A18): spazio distinto dagli effetti di magia. */
export type StatusKind = 'freeze' | 'shield';

export interface TrackedPiece {
  id: string;
  type: PieceSymbol;
  color: WireColor;
  effects: { kind: StatusKind; remaining: number }[];
}

export function toWireColor(color: 'w' | 'b'): WireColor {
  return color === 'w' ? 'white' : 'black';
}

export function toChessColor(color: WireColor): 'w' | 'b' {
  return color === 'white' ? 'w' : 'b';
}

/**
 * Tiene i `piece_id` stabili (G1): gli effetti seguono il pezzo, non la casella.
 * Va aggiornato a ogni cambiamento della scacchiera (mossa, Teleport, Fireball).
 */
export class PieceRegistry {
  private constructor(private readonly bySquare: Map<Square, TrackedPiece>) {}

  static fromChess(chess: Chess, rng: Rng): PieceRegistry {
    const map = new Map<Square, TrackedPiece>();
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell === null) continue;
        map.set(cell.square, { id: opaqueId('pc', rng), type: cell.type, color: toWireColor(cell.color), effects: [] });
      }
    }
    return new PieceRegistry(map);
  }

  at(square: Square): TrackedPiece | undefined {
    return this.bySquare.get(square);
  }

  squareOf(pieceId: string): Square | undefined {
    for (const [square, piece] of this.bySquare) if (piece.id === pieceId) return square;
    return undefined;
  }

  hasStatus(square: Square, kind: StatusKind): boolean {
    return this.at(square)?.effects.some((e) => e.kind === kind) ?? false;
  }

  /** Applica una mossa già eseguita da chess.js: catture, en passant, arrocco, promozione. */
  applyMove(move: Move): void {
    if (move.isEnPassant()) {
      this.bySquare.delete(`${move.to[0]}${move.from[1]}` as Square);
    } else if (move.isCapture()) {
      this.bySquare.delete(move.to);
    }
    this.relocate(move.from, move.to);
    if (move.promotion !== undefined) {
      const promoted = this.bySquare.get(move.to);
      if (promoted !== undefined) promoted.type = move.promotion;
    }
    if (move.isKingsideCastle() || move.isQueensideCastle()) {
      const rank = move.from[1];
      const [rookFrom, rookTo] = move.isKingsideCastle() ? ['h', 'f'] : ['a', 'd'];
      this.relocate(`${rookFrom}${rank}` as Square, `${rookTo}${rank}` as Square);
    }
  }

  relocate(from: Square, to: Square): void {
    const piece = this.bySquare.get(from);
    if (piece === undefined) return;
    this.bySquare.delete(from);
    this.bySquare.set(to, piece);
  }

  remove(square: Square): TrackedPiece | undefined {
    const piece = this.bySquare.get(square);
    this.bySquare.delete(square);
    return piece;
  }

  setStatus(square: Square, kind: StatusKind, turns: number): TrackedPiece | undefined {
    const piece = this.bySquare.get(square);
    if (piece === undefined) return undefined;
    piece.effects = [...piece.effects.filter((e) => e.kind !== kind), { kind, remaining: turns }];
    return piece;
  }

  /** M5: decrementa gli effetti dei pezzi di `color` a fine del suo turno. Restituisce quelli scaduti. */
  tickStatuses(color: WireColor): { pieceId: string; kind: StatusKind }[] {
    const expired: { pieceId: string; kind: StatusKind }[] = [];
    for (const piece of this.bySquare.values()) {
      if (piece.color !== color) continue;
      piece.effects = piece.effects
        .map((e) => ({ ...e, remaining: e.remaining - 1 }))
        .filter((e) => {
          if (e.remaining > 0) return true;
          expired.push({ pieceId: piece.id, kind: e.kind });
          return false;
        });
    }
    return expired;
  }

  toWire(): WirePiece[] {
    return [...this.bySquare.entries()].map(([square, piece]) => ({
      piece_id: piece.id,
      square,
      type: piece.type,
      color: piece.color,
      effects: piece.effects.map((e) => ({ kind: e.kind, remaining_turns: e.remaining })),
    }));
  }

  clone(): PieceRegistry {
    const map = new Map<Square, TrackedPiece>();
    for (const [square, piece] of this.bySquare) map.set(square, { ...piece, effects: piece.effects.map((e) => ({ ...e })) });
    return new PieceRegistry(map);
  }
}
