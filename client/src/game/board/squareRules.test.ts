import { describe, expect, it } from 'vitest';

import type { SquareEffects, Square } from '../model';
import { blockedMove } from './squareRules';

/** Gli stessi casi di `effects/squares_test.go`: il client non evidenzia ciò che il server rifiuterebbe. */

const walls = (...squares: Square[]): SquareEffects[] =>
  squares.map((square) => ({ square, effects: [{ kind: 'wall', remainingTurns: 2, sourceSpellId: 'ice_wall' }] }));

describe('stati delle case sulle mosse', () => {
  it('muri: la torre non attraversa, il cavallo scavalca ma non atterra', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K1N1 w - - 0 1';
    const states = walls('a4', 'f3');
    expect(blockedMove(fen, states, 'a1', 'a3')).toBe(false);
    expect(blockedMove(fen, states, 'a1', 'a4')).toBe(true);
    expect(blockedMove(fen, states, 'a1', 'a6')).toBe(true);
    expect(blockedMove(fen, states, 'g1', 'f3')).toBe(true);
    expect(blockedMove(fen, states, 'g1', 'h3')).toBe(false);
    expect(blockedMove(fen, walls('g2', 'f2'), 'g1', 'f3')).toBe(false);
  });

  it('spinta doppia e arrocco', () => {
    const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
    expect(blockedMove(fen, walls('e3'), 'e2', 'e4')).toBe(true);
    expect(blockedMove(fen, walls('e4'), 'e2', 'e3')).toBe(false);
    expect(blockedMove(fen, walls('f1'), 'e1', 'g1')).toBe(true);
    expect(blockedMove(fen, walls('b1'), 'e1', 'c1')).toBe(true);
    expect(blockedMove(fen, walls('b1'), 'e1', 'g1')).toBe(false);
  });

  it('santuario: nessuna cattura, en passant compreso; ci si entra', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/3QK3 w - d6 0 1';
    const states: SquareEffects[] = [
      { square: 'd5', effects: [{ kind: 'no_capture', remainingTurns: 3, sourceSpellId: 'sanctuary' }] },
      { square: 'd3', effects: [{ kind: 'no_capture', remainingTurns: 3, sourceSpellId: 'sanctuary' }] },
    ];
    expect(blockedMove(fen, states, 'd1', 'd5')).toBe(true);
    expect(blockedMove(fen, states, 'e5', 'd6')).toBe(true);
    expect(blockedMove(fen, states, 'd1', 'd4')).toBe(false);
    expect(blockedMove(fen, states, 'd1', 'd3')).toBe(false);
  });

  it('senza stati delle case non blocca nulla', () => {
    expect(blockedMove('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', [], 'a1', 'a8')).toBe(false);
  });
});
