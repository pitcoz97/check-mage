import { describe, expect, it } from 'vitest';

import type { HandCard, Square } from './model';
import type { Spell } from '../spells/schema';
import { beginTargeting, pickTarget, targetingCandidates, TARGETING_IDLE, type TargetingState } from './targeting';

/** Macchina di targeting: quali caselle sono valide, quando parte il cast, cosa viene rifiutato. */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ctx = { fen: START, myColor: 'white' } as const;
const card: HandCard = { instanceId: 'c1', spellId: 'x' };

const spell = (targetType: string, kind: string): Spell => ({
  id: 'x',
  name: 'X',
  manaCost: 1,
  phases: ['main1'],
  targetType,
  effects: [{ kind, params: {} }],
});

/** Stato `collecting` per la magia data. */
function collecting(targetType: string, kind: string): TargetingState {
  const outcome = beginTargeting(card, spell(targetType, kind));
  if (outcome.kind !== 'state') throw new Error(`atteso targeting, ricevuto ${outcome.kind}`);
  return outcome.state;
}

describe('targeting', () => {
  it('una magia senza bersagli parte subito', () => {
    expect(beginTargeting(card, spell('none', 'gain_mana'))).toEqual({ kind: 'cast', card, targets: [] });
  });

  it('un bersaglio: si entra in targeting e il cast parte alla prima casella valida', () => {
    const state = collecting('enemy_piece', 'freeze_piece');
    expect(targetingCandidates(state, ctx)).toContain('e7' satisfies Square);
    expect(pickTarget(state, ctx, 'e7')).toEqual({ kind: 'cast', card, targets: ['e7'] });
  });

  it('due bersagli: prima il pezzo, poi la casella vuota, e il cast porta i due in ordine', () => {
    const first = collecting('piece_move', 'move_piece');
    const afterPiece = pickTarget(first, ctx, 'b1');
    expect(afterPiece.kind).toBe('state');
    if (afterPiece.kind !== 'state') return;
    expect(afterPiece.state.kind === 'collecting' && afterPiece.state.chosen).toEqual(['b1']);
    // Al secondo passo si evidenziano le caselle vuote, non più i pezzi.
    expect(targetingCandidates(afterPiece.state, ctx)).not.toContain('b1' satisfies Square);
    expect(pickTarget(afterPiece.state, ctx, 'c3')).toEqual({ kind: 'cast', card, targets: ['b1', 'c3'] });
  });

  it('una casella fuori dai candidati viene rifiutata, senza perdere i bersagli già scelti', () => {
    const state = collecting('enemy_piece', 'destroy_piece');
    // Il re non si può distruggere: non è tra i candidati.
    expect(pickTarget(state, ctx, 'e8')).toEqual({ kind: 'refused', reason: 'invalid_target' });
    expect(pickTarget(state, ctx, 'e2')).toEqual({ kind: 'refused', reason: 'invalid_target' });
  });

  it('un tipo di bersaglio sconosciuto non apre il targeting', () => {
    expect(beginTargeting(card, spell('constellation', 'noop'))).toEqual({ kind: 'refused', reason: 'unsupported_target' });
  });

  it('da fermo non succede nulla', () => {
    expect(targetingCandidates(TARGETING_IDLE, ctx)).toEqual([]);
    expect(pickTarget(TARGETING_IDLE, ctx, 'e4')).toEqual({ kind: 'state', state: TARGETING_IDLE });
  });
});
