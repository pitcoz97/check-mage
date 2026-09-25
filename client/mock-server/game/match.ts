import { WS, type GameError } from '../serverTexts';
import { shuffle, type Rng } from '../util';
import type { WirePhase } from '../wire';
import { buildDeck, CATALOG, INITIAL_MANA, LIMIT_PER_TURN, MAX_MANA_CAP, STARTING_HAND, type Spell } from './catalog';
import type { Color } from './fen';

/**
 * Porting di `match/match.go` (FSM delle fasi + risorse del card game) e di `phase/*.go`.
 */

const ORDER: readonly WirePhase[] = ['draw', 'main1', 'move', 'main2', 'end_turn'];

type Action = 'pass_phase' | 'make_move' | 'cast_spell' | 'resign' | 'offer_draw';

/** `phase/actions.go:15-51`. */
const ALLOWED: Record<WirePhase, readonly Action[]> = {
  draw: ['pass_phase', 'resign', 'offer_draw'],
  main1: ['pass_phase', 'cast_spell', 'resign', 'offer_draw'],
  move: ['make_move', 'resign', 'offer_draw'],
  main2: ['pass_phase', 'cast_spell', 'resign', 'offer_draw'],
  end_turn: [],
};

export interface PlayerState {
  hand: string[];
  deck: string[];
  discard: string[];
  mana: number;
  max_mana: number;
  /** Cast di ogni magia nel turno corrente del giocatore (`Spell.limits`); si azzera all'inizio del suo turno. */
  casts_this_turn?: Record<string, number>;
  /** Cimitero: i pezzi persi, in ordine (`spells.GraveEntry`). */
  graveyard: GraveEntry[];
}

/** `GraveEntry` (`spells/spells.go`): il tipo del pezzo e il suo id (interno). */
export interface GraveEntry {
  piece: string;
  piece_id: number;
}

export interface DrawResult {
  player: Color;
  cardId: string;
  handSize: number;
  deckSize: number;
}

export interface ManaState {
  player: Color;
  current: number;
  max: number;
}

export interface AdvanceResult {
  phase: WirePhase;
  activePlayer: Color;
  turnNumber: number;
  newTurn: boolean;
  draw: DrawResult | null;
  mana: ManaState | null;
}

export interface CastResult {
  spell: Spell;
  effectsApplied: Record<string, unknown>[];
  targets: string[] | null;
  manaAfter: number;
  manaMax: number;
  handSize: number;
}

/** Callback con cui il room applica gli effetti sulla scacchiera; lancia `EffectError` per annullare a costo zero. */
export type ApplyEffects = (spell: Spell, targets: string[]) => Record<string, unknown>[];

export class CastError extends Error {
  constructor(readonly error: GameError) {
    super(error.message);
  }
}

/** Solo scenari e test: mano e cima del mazzo forzate, mana minimo garantito. Il server reale non li ha. */
export interface MatchOverrides {
  hand?: Partial<Record<Color, string[]>>;
  deckTop?: Partial<Record<Color, string[]>>;
  manaFloor?: Partial<Record<Color, number>>;
}

/** `spells/spells.go:141-157`. */
function newPlayerState(rng: Rng): PlayerState {
  const deck = shuffle(buildDeck(), rng);
  return { hand: deck.splice(0, STARTING_HAND), deck, discard: [], mana: INITIAL_MANA, max_mana: INITIAL_MANA, graveyard: [] };
}

/**
 * Rimuove dal mazzo una copia per ogni carta forzata (o, se la ricetta non ne ha abbastanza, l'ultima carta),
 * così il totale resta di 40 carte.
 */
function takeFromDeck(ps: PlayerState, ids: readonly string[]): string[] {
  return ids.map((id) => {
    const index = ps.deck.indexOf(id);
    ps.deck.splice(index >= 0 ? index : ps.deck.length - 1, 1);
    return id;
  });
}

/** `withinLimits` (`match.go`): una magia senza limiti è sempre entro i limiti. */
function withinLimits(def: Spell, ps: PlayerState): boolean {
  const perTurn = def.limits?.[LIMIT_PER_TURN];
  return perTurn === undefined || (ps.casts_this_turn?.[def.id] ?? 0) < perTurn;
}

export class MatchState {
  currentPhase: WirePhase = 'draw';
  turnNumber = 1;
  activePlayer: Color = 'white';
  readonly white: PlayerState;
  readonly black: PlayerState;

  /** `match.go:50-73`: il Bianco non pesca al turno 1. */
  constructor(
    rng: Rng,
    private readonly overrides: MatchOverrides = {},
  ) {
    this.white = newPlayerState(rng);
    this.black = newPlayerState(rng);
    for (const color of ['white', 'black'] as const) {
      const ps = this.player(color);
      const forcedHand = overrides.hand?.[color];
      if (forcedHand !== undefined) {
        ps.deck.push(...ps.hand);
        ps.hand = takeFromDeck(ps, forcedHand);
      }
      const top = overrides.deckTop?.[color];
      if (top !== undefined) ps.deck = [...takeFromDeck(ps, top), ...ps.deck];
      const floor = overrides.manaFloor?.[color];
      if (floor !== undefined) ps.mana = ps.max_mana = Math.max(ps.max_mana, floor);
    }
  }

  player(p: Color): PlayerState {
    return p === 'white' ? this.white : this.black;
  }

  private snapshot(r: Pick<AdvanceResult, 'newTurn' | 'draw' | 'mana'>): AdvanceResult {
    return { ...r, phase: this.currentPhase, activePlayer: this.activePlayer, turnNumber: this.turnNumber };
  }

  /** `match.go:154-178`: da main2 un Advance approda direttamente alla draw avversaria. */
  advance(): AdvanceResult {
    const index = ORDER.indexOf(this.currentPhase);
    const next = ORDER[(index + 1) % ORDER.length] as WirePhase;
    if (next !== 'end_turn') {
      this.currentPhase = next;
      return this.snapshot({ newTurn: false, draw: null, mana: null });
    }
    this.activePlayer = this.activePlayer === 'white' ? 'black' : 'white';
    this.turnNumber++;
    this.currentPhase = 'draw';
    delete this.player(this.activePlayer).casts_this_turn; // i limiti per turno ripartono
    const mana = this.refreshMana(this.activePlayer);
    const draw = this.drawCard(this.activePlayer);
    return this.snapshot({ newTurn: true, draw, mana });
  }

  drawFor(p: Color): DrawResult {
    return this.drawCard(p);
  }

  /** `GainMana`: senza `exceedCap` non supera il tetto assoluto (`MaxManaCap`). */
  gainMana(p: Color, amount: number, exceedCap: boolean): ManaState {
    const ps = this.player(p);
    ps.mana = exceedCap ? ps.mana + amount : Math.min(MAX_MANA_CAP, ps.mana + amount);
    return { player: p, current: ps.mana, max: ps.max_mana };
  }

  /** `match.go:198-214`. */
  canCastAny(): boolean {
    if (!this.allows('cast_spell')) return false;
    const ps = this.player(this.activePlayer);
    return ps.hand.some((id) => {
      const def = CATALOG.get(id);
      return def !== undefined && def.mana_cost <= ps.mana && def.phases.includes(this.currentPhase) && withinLimits(def, ps);
    });
  }

  /** `match.go:216-239`. */
  autoAdvance(): AdvanceResult[] {
    const results: AdvanceResult[] = [];
    for (let i = 0; i < 12 && this.shouldAutoAdvance(); i++) results.push(this.advance());
    return results;
  }

  private shouldAutoAdvance(): boolean {
    if (this.currentPhase === 'draw') return true;
    if (this.currentPhase === 'main1' || this.currentPhase === 'main2') return !this.canCastAny();
    return false;
  }

  /** `match.go:241-261`. */
  private refreshMana(p: Color): ManaState {
    const ps = this.player(p);
    const index = p === 'white' ? Math.floor((this.turnNumber + 1) / 2) : Math.floor(this.turnNumber / 2);
    ps.max_mana = Math.min(index, MAX_MANA_CAP);
    const floor = this.overrides.manaFloor?.[p];
    if (floor !== undefined) ps.max_mana = Math.max(ps.max_mana, floor);
    ps.mana = ps.max_mana;
    return { player: p, current: ps.mana, max: ps.max_mana };
  }

  /** `match.go:263-290`. */
  private drawCard(p: Color): DrawResult {
    const ps = this.player(p);
    const card = ps.deck.shift();
    if (card !== undefined) ps.hand.push(card);
    return { player: p, cardId: card ?? '', handSize: ps.hand.length, deckSize: ps.deck.length };
  }

  /** `match.go:300-353`: valida, applica gli effetti PRIMA di spendere, poi scala mana e scarta. */
  castSpell(p: Color, spellId: string, targets: string[] | null, apply: ApplyEffects): CastResult {
    if (!this.isActive(p)) throw new CastError(WS.castNotYourTurn);
    if (!this.allows('cast_spell')) throw new CastError(WS.castWrongPhase(this.currentPhase));
    const def = CATALOG.get(spellId);
    if (def === undefined) throw new CastError(WS.unknownSpell(spellId));
    if (!def.phases.includes(this.currentPhase)) throw new CastError(WS.spellWrongPhase(def.name, this.currentPhase));
    const ps = this.player(p);
    const index = ps.hand.indexOf(spellId);
    if (index < 0) throw new CastError(WS.cardNotInHand(spellId));
    if (ps.mana < def.mana_cost) throw new CastError(WS.insufficientMana(def.mana_cost, ps.mana));
    if (!withinLimits(def, ps)) throw new CastError(WS.limitReached(def.name, def.id, def.limits?.[LIMIT_PER_TURN] ?? 0));
    const received = targets?.length ?? 0;
    const expected = def.targets.length;
    if (received !== expected) throw new CastError(WS.wrongTargetCount(def.name, expected, received));

    const effectsApplied = apply(def, targets ?? []);

    ps.mana -= def.mana_cost;
    ps.hand.splice(index, 1);
    ps.discard.push(spellId);
    ps.casts_this_turn = { ...ps.casts_this_turn, [spellId]: (ps.casts_this_turn?.[spellId] ?? 0) + 1 };
    return { spell: def, effectsApplied, targets, manaAfter: ps.mana, manaMax: ps.max_mana, handSize: ps.hand.length };
  }

  isActive(p: Color): boolean {
    return this.activePlayer === p;
  }

  allows(action: Action): boolean {
    return ALLOWED[this.currentPhase].includes(action);
  }
}
