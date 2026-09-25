import { describe, expect, it } from 'vitest';

import type { Square } from '../model';
import { dropOnSquare, pickupRefusal, tapSquare, type BoardContext } from './selection';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PROMOTION = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

function context(overrides: Partial<BoardContext> = {}): BoardContext {
  return {
    fen: START,
    myColor: 'white',
    activePlayer: 'white',
    phase: 'move',
    frozen: new Set<Square>(),
    squareStates: [],
    canAct: true,
    ...overrides,
  };
}

describe('pickupRefusal', () => {
  it('il pezzo si prende solo nel proprio turno, in fase move, se è proprio e non congelato', () => {
    expect(pickupRefusal(context(), 'e2')).toBeNull();
    expect(pickupRefusal(context(), 'e7')).toBe('not_your_piece');
    expect(pickupRefusal(context(), 'e4')).toBe('not_your_piece');
    expect(pickupRefusal(context({ myColor: null }), 'e2')).toBe('not_your_piece');
    expect(pickupRefusal(context({ canAct: false }), 'e2')).toBe('not_connected');
    expect(pickupRefusal(context({ activePlayer: 'black' }), 'e2')).toBe('not_your_turn');
    expect(pickupRefusal(context({ phase: 'main1' }), 'e2')).toBe('wrong_phase');
    expect(pickupRefusal(context({ frozen: new Set<Square>(['e2']) }), 'e2')).toBe('piece_frozen');
  });
});

describe('tapSquare', () => {
  it('tap sul pezzo → selezione con i bersagli; secondo tap sul bersaglio → mossa', () => {
    const first = tapSquare(context(), null, 'e2');
    expect(first).toEqual({ kind: 'selection', selection: { from: 'e2', targets: ['e3', 'e4'] } });
    if (first.kind !== 'selection') throw new Error('atteso selection');
    expect(tapSquare(context(), first.selection, 'e4')).toEqual({ kind: 'move', from: 'e2', to: 'e4', promotion: false });
  });

  it('tap sulla stessa casella deseleziona; tap su un altro proprio pezzo sposta la selezione', () => {
    const selection = { from: 'e2' as Square, targets: ['e3', 'e4'] as Square[] };
    expect(tapSquare(context(), selection, 'e2')).toEqual({ kind: 'selection', selection: null });
    expect(tapSquare(context(), selection, 'd2')).toMatchObject({ kind: 'selection', selection: { from: 'd2' } });
  });

  it('tap su una casella qualsiasi annulla senza avvisi; il rifiuto arriva solo al primo tap', () => {
    const selection = { from: 'e2' as Square, targets: ['e3', 'e4'] as Square[] };
    expect(tapSquare(context(), selection, 'h5')).toEqual({ kind: 'selection', selection: null });
    expect(tapSquare(context({ phase: 'main1' }), null, 'e2')).toEqual({ kind: 'refused', reason: 'wrong_phase' });
  });

  it('le mosse vietate da muri e santuari non sono fra i bersagli', () => {
    const wall = { square: 'e3' as Square, effects: [{ kind: 'wall', remainingTurns: 2, sourceSpellId: 'ice_wall' }] };
    expect(tapSquare(context({ squareStates: [wall] }), null, 'e2')).toEqual({ kind: 'selection', selection: { from: 'e2', targets: [] } });
    expect(tapSquare(context({ squareStates: [wall] }), null, 'd2')).toEqual({ kind: 'selection', selection: { from: 'd2', targets: ['d3', 'd4'] } });
  });

  it('promozione segnalata alla UI, che chiede quale pezzo', () => {
    const ctx = context({ fen: PROMOTION });
    const picked = tapSquare(ctx, null, 'a7');
    if (picked.kind !== 'selection') throw new Error('atteso selection');
    expect(tapSquare(ctx, picked.selection, 'a8')).toEqual({ kind: 'move', from: 'a7', to: 'a8', promotion: true });
  });
});

describe('dropOnSquare', () => {
  it('rilascio su un bersaglio = mossa; fuori dai bersagli la selezione resta per il tap', () => {
    const selection = { from: 'e2' as Square, targets: ['e3', 'e4'] as Square[] };
    expect(dropOnSquare(context(), selection, 'e3')).toEqual({ kind: 'move', from: 'e2', to: 'e3', promotion: false });
    expect(dropOnSquare(context(), selection, 'h6')).toEqual({ kind: 'selection', selection });
    expect(dropOnSquare(context(), null, 'e3')).toEqual({ kind: 'selection', selection: null });
  });
});
