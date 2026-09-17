import { WS } from '../serverTexts';
import { EffectError, parsePlacement, pieceColor, squareName, type Color } from './fen';

/**
 * Porting 1:1 di `effects/tracker.go`: identità dei pezzi ed effetti persistenti, in parallelo alla FEN.
 * Replica anche l'euristica di `MovePiece` usata per Teleport (BACKEND-REQUESTS B13, B14).
 */

export const KIND_FREEZE = 'freeze';
export const KIND_SHIELD = 'shield';

export interface ActiveEffect {
  kind: string;
  remaining_turns: number;
  source_spell_id?: string;
}

interface PieceState {
  id: number;
  type: string;
  square: string;
  effects: ActiveEffect[];
}

export interface ExpiredEffect {
  pieceId: number;
  square: string;
  kind: string;
}

export interface PieceEffectInfo {
  square: string;
  effects: ActiveEffect[];
}

export class Tracker {
  private readonly bySquare = new Map<string, number>();
  private readonly pieces = new Map<number, PieceState>();
  private nextId = 1;

  /** `tracker.go:38-58`: id assegnati in ordine di scansione (a8 → h1). */
  constructor(fen: string) {
    const grid = parsePlacement(fen);
    grid.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell === null) return;
        const id = this.nextId++;
        const square = squareName(r, c);
        this.pieces.set(id, { id, type: cell, square, effects: [] });
        this.bySquare.set(square, id);
      }),
    );
  }

  /** `tracker.go:67-95`. */
  movePiece(from: string, to: string, promo: string | null): void {
    const id = this.bySquare.get(from);
    if (id === undefined) return;
    const ps = this.pieces.get(id) as PieceState;

    if (this.bySquare.has(to)) {
      this.removeAt(to);
    } else if (isPawn(ps.type) && from[0] !== to[0]) {
      // En passant "euristico": vale anche per un Teleport diagonale di un pedone (B14).
      this.removeAt(`${to[0]}${from[1]}`);
    }
    this.bySquare.delete(from);
    this.bySquare.set(to, id);
    ps.square = to;

    if (promo !== null) ps.type = pieceColor(ps.type) === 'white' ? promo.toUpperCase() : promo.toLowerCase();
    // Un re che arriva su g1/c1/g8/c8 sposta la torre, anche se è un Teleport (B13).
    if (isKing(ps.type)) this.moveCastlingRook(to);
  }

  private moveCastlingRook(kingTo: string): void {
    const rook: Record<string, [string, string]> = { g1: ['h1', 'f1'], c1: ['a1', 'd1'], g8: ['h8', 'f8'], c8: ['a8', 'd8'] };
    const pair = rook[kingTo];
    if (pair === undefined) return;
    const id = this.bySquare.get(pair[0]);
    if (id === undefined) return;
    this.bySquare.delete(pair[0]);
    this.bySquare.set(pair[1], id);
    (this.pieces.get(id) as PieceState).square = pair[1];
  }

  removeAt(square: string): void {
    const id = this.bySquare.get(square);
    if (id === undefined) return;
    this.bySquare.delete(square);
    this.pieces.delete(id);
  }

  private colorAt(square: string): Color | null {
    const id = this.bySquare.get(square);
    return id === undefined ? null : pieceColor((this.pieces.get(id) as PieceState).type);
  }

  /** `tracker.go:135-150`. */
  private addEffect(square: string, kind: string, turns: number, source: string): void {
    const id = this.bySquare.get(square);
    if (id === undefined) throw new EffectError(WS.nothingAt(square));
    const ps = this.pieces.get(id) as PieceState;
    const existing = ps.effects.find((e) => e.kind === kind);
    if (existing !== undefined) {
      existing.remaining_turns = turns;
      existing.source_spell_id = source;
      return;
    }
    ps.effects.push({ kind, remaining_turns: turns, source_spell_id: source });
  }

  /** `tracker.go:153-162`. */
  freeze(square: string, caster: Color, turns: number, source: string): void {
    const color = this.colorAt(square);
    if (color === null) throw new EffectError(WS.nothingToFreeze(square));
    if (color === caster) throw new EffectError(WS.cannotFreezeOwn(square));
    this.addEffect(square, KIND_FREEZE, turns, source);
  }

  /** `tracker.go:165-174`. */
  shield(square: string, caster: Color, turns: number, source: string): void {
    const color = this.colorAt(square);
    if (color === null) throw new EffectError(WS.nothingToShield(square));
    if (color !== caster) throw new EffectError(WS.shieldOnlyOwn(square));
    this.addEffect(square, KIND_SHIELD, turns, source);
  }

  private hasEffect(square: string, kind: string): boolean {
    const id = this.bySquare.get(square);
    if (id === undefined) return false;
    return (this.pieces.get(id) as PieceState).effects.some((e) => e.kind === kind && e.remaining_turns > 0);
  }

  isFrozen(square: string): boolean {
    return this.hasEffect(square, KIND_FREEZE);
  }

  hasShield(square: string): boolean {
    return this.hasEffect(square, KIND_SHIELD);
  }

  /** `tracker.go:196-209`. */
  consumeShield(square: string): void {
    const id = this.bySquare.get(square);
    if (id === undefined) return;
    const ps = this.pieces.get(id) as PieceState;
    ps.effects = ps.effects.filter((e) => e.kind !== KIND_SHIELD);
  }

  /** `tracker.go:221-239`: decrementa gli effetti dei pezzi di `color` (chi ha appena chiuso il turno). */
  tickColor(color: Color): ExpiredEffect[] {
    const expired: ExpiredEffect[] = [];
    for (const ps of this.pieces.values()) {
      if (pieceColor(ps.type) !== color || ps.effects.length === 0) continue;
      ps.effects = ps.effects.filter((e) => {
        e.remaining_turns--;
        if (e.remaining_turns > 0) return true;
        expired.push({ pieceId: ps.id, square: ps.square, kind: e.kind });
        return false;
      });
    }
    return expired;
  }

  /** `tracker.go:259-267`. */
  activeEffects(): PieceEffectInfo[] {
    const out: PieceEffectInfo[] = [];
    for (const ps of this.pieces.values()) {
      if (ps.effects.length > 0) out.push({ square: ps.square, effects: ps.effects.map((e) => ({ ...e })) });
    }
    return out;
  }

  /** Solo per i test del mock: identità del pezzo in una casella. */
  idAt(square: string): number | undefined {
    return this.bySquare.get(square);
  }
}

function isPawn(p: string): boolean {
  return p === 'p' || p === 'P';
}

function isKing(p: string): boolean {
  return p === 'k' || p === 'K';
}
