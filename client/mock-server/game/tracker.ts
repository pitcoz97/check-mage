import { WS } from '../serverTexts';
import { EffectError, parsePlacement, pieceColor, squareName, type Color } from './fen';

/**
 * Porting 1:1 di `effects/tracker.go`: identità dei pezzi ed effetti persistenti, in parallelo alla FEN.
 * Le mosse di scacchi passano da `movePiece`, gli spostamenti magici da `relocate` (B13, B14 risolti).
 */

export const KIND_FREEZE = 'freeze';
export const KIND_SHIELD = 'shield';

/**
 * `remaining_turns` conta i turni dell'avversario di `caster` ancora coperti; 0 = fino alla fine del turno di
 * `caster`; `PERMANENT` = non scade (`tracker.go`, `ActiveEffect`).
 */
export interface ActiveEffect {
  kind: string;
  remaining_turns: number;
  source_spell_id?: string;
  caster?: Color;
  /** Solo per le rune (`runes.go`): nascosta all'avversario di `caster`. Assente quando è falsa (omitempty). */
  hidden?: boolean;
  /** Solo per le rune: cosa fa quando scatta, copiato dai params al lancio. */
  rune?: RuneSpec;
}

/** `RuneSpec` (`effects/runes.go`): i campi vuoti mancano (omitempty). */
export interface RuneSpec {
  on_enter: string;
  duration?: number;
  only?: string[];
  fallback?: string;
  fallback_duration?: number;
}

export const KIND_RUNE = 'rune';

export const PERMANENT = -1;

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
  /** Stati sulle case (`squares.go`): restano sulla casa, con le durate degli stati sui pezzi. */
  private squares = new Map<string, ActiveEffect[]>();

  /** `tracker.go:41-62`: id assegnati in ordine di scansione (a8 → h1). */
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

  /** `tracker.go:69-99`: catture, en passant, promozione e arrocco. */
  movePiece(from: string, to: string, promo: string | null): void {
    const id = this.bySquare.get(from);
    if (id === undefined) return;
    const ps = this.pieces.get(id) as PieceState;

    if (this.bySquare.has(to)) {
      this.removeAt(to);
    } else if (isPawn(ps.type) && from[0] !== to[0]) {
      // En passant: pedone in diagonale su casella vuota.
      this.removeAt(`${to[0]}${from[1]}`);
    }
    this.bySquare.delete(from);
    this.bySquare.set(to, id);
    ps.square = to;

    if (promo !== null) ps.type = pieceColor(ps.type) === 'white' ? promo.toUpperCase() : promo.toLowerCase();
    // Arrocco: il re che arriva su g1/c1/g8/c8 sposta anche la torre.
    if (isKing(ps.type)) this.moveCastlingRook(to);
  }

  /**
   * `tracker.go:101-116`: sposta identità ed effetti senza semantica scacchistica (niente en passant, arrocco o
   * promozione). Per `move_piece`.
   */
  relocate(from: string, to: string): void {
    const id = this.bySquare.get(from);
    if (id === undefined) return;
    if (this.bySquare.has(to)) this.removeAt(to); // non dovrebbe accadere: move_piece richiede una casella vuota
    this.bySquare.delete(from);
    this.bySquare.set(to, id);
    (this.pieces.get(id) as PieceState).square = to;
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

  /** `Tracker.Add`: un pezzo nuovo (es. un pedone evocato) con un id nuovo e nessun effetto. */
  add(square: string, piece: string): void {
    this.removeAt(square);
    const id = this.nextId++;
    this.pieces.set(id, { id, type: piece, square, effects: [] });
    this.bySquare.set(square, id);
  }

  /** `Tracker.Swap`: scambia identità ed effetti dei pezzi di due case. */
  swap(a: string, b: string): void {
    const ida = this.bySquare.get(a);
    const idb = this.bySquare.get(b);
    if (ida === undefined || idb === undefined) return;
    this.bySquare.set(a, idb);
    this.bySquare.set(b, ida);
    (this.pieces.get(ida) as PieceState).square = b;
    (this.pieces.get(idb) as PieceState).square = a;
  }

  /** `Tracker.SetType`: cambia il tipo del pezzo, conservando id ed effetti. */
  setType(square: string, piece: string): void {
    const id = this.bySquare.get(square);
    if (id !== undefined) (this.pieces.get(id) as PieceState).type = piece;
  }

  /** `Tracker.Info`: id e carattere FEN del pezzo nella casa. */
  info(square: string): { id: number; piece: string } | null {
    const id = this.bySquare.get(square);
    return id === undefined ? null : { id, piece: (this.pieces.get(id) as PieceState).type };
  }

  /** `Tracker.Clone`: una copia indipendente, su cui si applicano gli effetti di una magia. */
  clone(): Tracker {
    const copy = Object.create(Tracker.prototype) as Tracker;
    const fields = copy as unknown as { bySquare: Map<string, number>; pieces: Map<number, PieceState>; nextId: number };
    fields.bySquare = new Map(this.bySquare);
    fields.pieces = new Map([...this.pieces].map(([id, ps]) => [id, { ...ps, effects: ps.effects.map((e) => ({ ...e })) }]));
    fields.nextId = this.nextId;
    (copy as unknown as { squares: Map<string, ActiveEffect[]> }).squares = new Map(
      [...this.squares].map(([square, effects]) => [square, effects.map((e) => ({ ...e }))]),
    );
    return copy;
  }

  /** `addEffect` (`tracker.go`). */
  private addEffect(square: string, kind: string, turns: number, source: string, caster: Color): void {
    const id = this.bySquare.get(square);
    if (id === undefined) throw new EffectError(WS.nothingAt(square));
    const ps = this.pieces.get(id) as PieceState;
    const existing = ps.effects.find((e) => e.kind === kind);
    if (existing !== undefined) {
      existing.remaining_turns = turns;
      existing.source_spell_id = source;
      existing.caster = caster;
      return;
    }
    ps.effects.push({ kind, remaining_turns: turns, source_spell_id: source, caster });
  }

  /** `tracker.go:173-183`. */
  freeze(square: string, caster: Color, turns: number, source: string): void {
    const color = this.colorAt(square);
    if (color === null) throw new EffectError(WS.nothingToFreeze(square));
    if (color === caster) throw new EffectError(WS.cannotFreezeOwn(square));
    this.addEffect(square, KIND_FREEZE, turns, source, caster);
  }

  /** `tracker.go:185-195`. */
  shield(square: string, caster: Color, turns: number, source: string): void {
    const color = this.colorAt(square);
    if (color === null) throw new EffectError(WS.nothingToShield(square));
    if (color !== caster) throw new EffectError(WS.shieldOnlyOwn(square));
    this.addEffect(square, KIND_SHIELD, turns, source, caster);
  }

  /** `HasEffect`: gli effetti scaduti sono già stati tolti da `tickTurnEnd`, quindi basta la presenza. */
  hasEffect(square: string, kind: string): boolean {
    const id = this.bySquare.get(square);
    if (id === undefined) return false;
    return (this.pieces.get(id) as PieceState).effects.some((e) => e.kind === kind);
  }

  isFrozen(square: string): boolean {
    return this.hasEffect(square, KIND_FREEZE);
  }

  hasShield(square: string): boolean {
    return this.hasEffect(square, KIND_SHIELD);
  }

  /** `tracker.go:216-230`. */
  consumeShield(square: string): void {
    const id = this.bySquare.get(square);
    if (id === undefined) return;
    const ps = this.pieces.get(id) as PieceState;
    ps.effects = ps.effects.filter((e) => e.kind !== KIND_SHIELD);
  }

  /**
   * `TickTurnEnd`: alla fine del turno di `finishing` scendono gli effetti lanciati dal suo avversario; quelli a 0
   * scadono. Un effetto a 0 lanciato da `finishing` scade alla fine del suo turno. Scaduti ordinati per casella.
   */
  tickTurnEnd(finishing: Color): ExpiredEffect[] {
    const expired: ExpiredEffect[] = [];
    for (const ps of this.pieces.values()) {
      if (ps.effects.length === 0) continue;
      ps.effects = ps.effects.filter((e) => {
        if (e.remaining_turns === PERMANENT) return true;
        if (e.caster !== finishing) e.remaining_turns--;
        if (e.remaining_turns > 0) return true;
        expired.push({ pieceId: ps.id, square: ps.square, kind: e.kind });
        return false;
      });
    }
    return expired.sort((a, b) => (a.square < b.square ? -1 : a.square > b.square ? 1 : 0));
  }

  /** `tracker.go:279-292`: copie degli effetti, ordinate per casella. */
  activeEffects(): PieceEffectInfo[] {
    const out: PieceEffectInfo[] = [];
    for (const ps of this.pieces.values()) {
      if (ps.effects.length > 0) out.push({ square: ps.square, effects: ps.effects.map((e) => ({ ...e })) });
    }
    return out.sort((a, b) => (a.square < b.square ? -1 : a.square > b.square ? 1 : 0));
  }

  /** `AddSquareEffect`: mette (o rinnova) uno stato sulla casa. */
  addSquareEffect(square: string, kind: string, turns: number, source: string, caster: Color): void {
    this.putSquareEffect(square, { kind, remaining_turns: turns, source_spell_id: source, caster });
  }

  /** `putSquareEffect`: sostituisce lo stato dello stesso tipo; le rune sono una per proprietario. */
  private putSquareEffect(square: string, next: ActiveEffect): void {
    const effects = this.squares.get(square) ?? [];
    const index = effects.findIndex((e) => e.kind === next.kind && (next.kind !== KIND_RUNE || e.caster === next.caster));
    if (index >= 0) effects[index] = next;
    else effects.push(next);
    this.squares.set(square, effects);
  }

  /** `AddRune`: runa nascosta, permanente; quella dello stesso proprietario sulla casa viene sostituita. */
  addRune(square: string, owner: Color, spec: RuneSpec, source: string): void {
    const rune: RuneSpec = { ...spec };
    if (spec.only !== undefined) rune.only = [...spec.only];
    this.putSquareEffect(square, { kind: KIND_RUNE, remaining_turns: PERMANENT, source_spell_id: source, caster: owner, hidden: true, rune });
  }

  /** `RuneAt`: la runa del proprietario sulla casa. */
  runeAt(square: string, owner: Color): ActiveEffect | null {
    return this.squares.get(square)?.find((e) => e.kind === KIND_RUNE && e.caster === owner) ?? null;
  }

  /** `RunesOf`: le case con una runa del proprietario, in ordine. */
  runesOf(owner: Color): string[] {
    return [...this.squares.keys()].filter((square) => this.runeAt(square, owner) !== null).sort();
  }

  /** `RemoveRune`. */
  removeRune(square: string, owner: Color): void {
    const kept = (this.squares.get(square) ?? []).filter((e) => !(e.kind === KIND_RUNE && e.caster === owner));
    if (kept.length === 0) this.squares.delete(square);
    else this.squares.set(square, kept);
  }

  /** `RevealRunes`: rende visibili per sempre le rune del proprietario che esistono ora; quante erano nascoste. */
  revealRunes(owner: Color): number {
    let n = 0;
    for (const effects of this.squares.values()) {
      for (const e of effects) {
        if (e.kind === KIND_RUNE && e.caster === owner && e.hidden === true) {
          delete e.hidden;
          n++;
        }
      }
    }
    return n;
  }

  /** `SquareEffectsFor`: la lista vista da `viewer`, senza le rune nascoste del suo avversario. */
  squareEffectsFor(viewer: Color): PieceEffectInfo[] {
    return this.squareEffects()
      .map(({ square, effects }) => ({
        square,
        effects: effects.filter((e) => !(e.kind === KIND_RUNE && e.hidden === true && e.caster !== viewer)),
      }))
      .filter((s) => s.effects.length > 0);
  }

  hasSquareEffect(square: string, kind: string): boolean {
    return this.squares.get(square)?.some((e) => e.kind === kind) === true;
  }

  hasSquareEffects(): boolean {
    return this.squares.size > 0;
  }

  /** `TickSquares`: le regole di `tickTurnEnd` sugli stati delle case; `true` se qualcuno è scaduto. */
  tickSquares(finishing: Color): boolean {
    let expired = false;
    for (const [square, effects] of this.squares) {
      const kept = effects.filter((e) => {
        if (e.remaining_turns === PERMANENT) return true;
        if (e.caster !== finishing) e.remaining_turns--;
        if (e.remaining_turns > 0) return true;
        expired = true;
        return false;
      });
      if (kept.length === 0) this.squares.delete(square);
      else this.squares.set(square, kept);
    }
    return expired;
  }

  /** `SquareEffects`: copie degli stati delle case, ordinate per casa. */
  squareEffects(): PieceEffectInfo[] {
    return [...this.squares]
      .map(([square, effects]) => ({ square, effects: effects.map((e) => ({ ...e })) }))
      .sort((a, b) => (a.square < b.square ? -1 : a.square > b.square ? 1 : 0));
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
