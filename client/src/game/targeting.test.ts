import { describe, expect, it } from 'vitest';

import type { HandCard, Square } from './model';
import { targetSpec, testSpell } from '../testing/catalog';
import type { Spell } from '../spells/schema';
import { beginTargeting, pickChoice, pickTarget, targetingCandidates, TARGETING_IDLE, type TargetingState } from './targeting';

/** Macchina di targeting: quali caselle sono valide, quando parte il cast, cosa viene rifiutato. */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ctx = { fen: START, myColor: 'white', effects: [], squareStates: [], graveyard: [] } as const;
const card: HandCard = { instanceId: 'c1', spellId: 'x' };

/** Blink: un proprio pezzo minore, poi una casa vuota entro 2. */
const BLINK = testSpell({
  targets: [targetSpec('own_piece', { pieces: ['knight', 'bishop'] }), targetSpec('square', { emptySquare: true, maxDistance: 2 })],
  effects: [{ kind: 'move_piece', params: {} }],
});

/** Stato `collecting` per la magia data. */
function collecting(spell: Spell): TargetingState {
  const outcome = beginTargeting(card, spell, ctx);
  if (outcome.kind !== 'state') throw new Error(`atteso targeting, ricevuto ${outcome.kind}`);
  return outcome.state;
}

describe('targeting', () => {
  it('una magia senza bersagli parte subito', () => {
    expect(beginTargeting(card, testSpell({ targets: [] }), ctx)).toEqual({ kind: 'cast', card, targets: [], choice: null });
  });

  it('un bersaglio: si entra in targeting e il cast parte alla prima casella valida', () => {
    const state = collecting(testSpell());
    expect(targetingCandidates(state, ctx)).toContain('e7' satisfies Square);
    expect(pickTarget(state, ctx, 'e7')).toEqual({ kind: 'cast', card, targets: ['e7'], choice: null });
  });

  it('due bersagli: prima il pezzo, poi la casella entro la distanza, e il cast porta i due in ordine', () => {
    const first = collecting(BLINK);
    expect(targetingCandidates(first, ctx)).toEqual(['b1', 'c1', 'f1', 'g1']);
    const afterPiece = pickTarget(first, ctx, 'b1');
    expect(afterPiece.kind).toBe('state');
    if (afterPiece.kind !== 'state') return;
    expect(afterPiece.state.kind === 'collecting' && afterPiece.state.chosen).toEqual(['b1']);
    // Al secondo passo le case vuote entro 2 da b1: la terza traversa, da a a d.
    expect([...targetingCandidates(afterPiece.state, ctx)].sort()).toEqual(['a3', 'b3', 'c3', 'd3']);
    expect(pickTarget(afterPiece.state, ctx, 'b4')).toEqual({ kind: 'refused', reason: 'invalid_target' });
    expect(pickTarget(afterPiece.state, ctx, 'c3')).toEqual({ kind: 'cast', card, targets: ['b1', 'c3'], choice: null });
  });

  it('una casella fuori dai candidati viene rifiutata: il re non è mai un bersaglio', () => {
    const state = collecting(testSpell());
    expect(pickTarget(state, ctx, 'e8')).toEqual({ kind: 'refused', reason: 'invalid_target' });
    expect(pickTarget(state, ctx, 'e2')).toEqual({ kind: 'refused', reason: 'invalid_target' });
  });

  it('un tipo di bersaglio sconosciuto non apre il targeting', () => {
    expect(beginTargeting(card, testSpell({ targets: [targetSpec('constellation')] }), ctx)).toEqual({
      kind: 'refused',
      reason: 'unsupported_target',
    });
  });

  it('dopo i bersagli, la scelta del pezzo: opzioni dal registry, cast con la scelta', () => {
    const promote = testSpell({
      targets: [targetSpec('own_piece', { pieces: ['pawn'] })],
      effects: [{ kind: 'promote_piece', params: { choices: ['knight', 'bishop', 'rook', 'queen'] } }],
    });
    const choosing = pickTarget(collecting(promote), ctx, 'e2');
    expect(choosing.kind).toBe('state');
    if (choosing.kind !== 'state' || choosing.state.kind !== 'choosing') throw new Error('attesa la scelta');
    expect(choosing.state.options).toEqual(['knight', 'bishop', 'rook', 'queen']);
    expect(targetingCandidates(choosing.state, ctx)).toEqual([]);
    expect(pickChoice(choosing.state, 'king')).toEqual({ kind: 'state', state: choosing.state });
    expect(pickChoice(choosing.state, 'rook')).toEqual({ kind: 'cast', card, targets: ['e2'], choice: 'rook' });
  });

  it('ritorno dal cimitero: si sceglie solo fra i tipi presenti, e con uno solo non si chiede', () => {
    const revive = testSpell({
      targets: [targetSpec('square', { emptySquare: true })],
      effects: [{ kind: 'revive_piece', params: { pieces: ['knight', 'bishop', 'rook'] } }],
    });
    const two = { ...ctx, graveyard: ['pawn', 'rook', 'knight', 'knight'] } as const;
    const withTwo = pickTarget(collecting(revive), two, 'e4');
    expect(withTwo.kind === 'state' && withTwo.state.kind === 'choosing' && withTwo.state.options).toEqual(['knight', 'rook']);
    const one = { ...ctx, graveyard: ['pawn', 'rook'] } as const;
    expect(pickTarget(collecting(revive), one, 'e4')).toEqual({ kind: 'cast', card, targets: ['e4'], choice: null });
  });

  it('da fermo non succede nulla', () => {
    expect(targetingCandidates(TARGETING_IDLE, ctx)).toEqual([]);
    expect(pickTarget(TARGETING_IDLE, ctx, 'e4')).toEqual({ kind: 'state', state: TARGETING_IDLE });
  });
});
