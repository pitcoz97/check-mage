import { describe, expect, it } from 'vitest';

import { moveBlock } from './squares';
import { Tracker } from './tracker';

/** Porting di `effects/squares_test.go`. */

function withWalls(fen: string, ...squares: string[]): Tracker {
  const tracker = new Tracker(fen);
  for (const square of squares) tracker.addSquareEffect(square, 'wall', 2, 'ice_wall', 'white');
  return tracker;
}

describe('stati delle case (effects/squares.go)', () => {
  it('muri: la torre non attraversa, il cavallo scavalca ma non atterra', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K1N1 w - - 0 1';
    const tracker = withWalls(fen, 'a4', 'f3');
    expect(moveBlock(fen, tracker, 'a1a3')).toBeNull();
    expect(moveBlock(fen, tracker, 'a1a4')).toEqual({ square: 'a4', reason: 'wall' });
    expect(moveBlock(fen, tracker, 'a1a6')).toEqual({ square: 'a4', reason: 'wall' });
    expect(moveBlock(fen, tracker, 'g1f3')).toEqual({ square: 'f3', reason: 'wall' });
    expect(moveBlock(fen, tracker, 'g1h3')).toBeNull();
    expect(moveBlock(fen, withWalls(fen, 'g2', 'f2'), 'g1f3')).toBeNull();
  });

  it('spinta doppia e arrocco', () => {
    const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
    expect(moveBlock(fen, withWalls(fen, 'e3'), 'e2e4')).toEqual({ square: 'e3', reason: 'wall' });
    expect(moveBlock(fen, withWalls(fen, 'e4'), 'e2e3')).toBeNull();
    for (const [move, wall] of [
      ['e1g1', 'f1'],
      ['e1g1', 'g1'],
      ['e1c1', 'b1'],
      ['e1c1', 'd1'],
    ] as const) {
      expect(moveBlock(fen, withWalls(fen, wall), move)).toEqual({ square: wall, reason: 'wall' });
    }
    expect(moveBlock(fen, withWalls(fen, 'b1'), 'e1g1')).toBeNull();
  });

  it('santuario: nessuna cattura, en passant compreso; ci si entra', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/3QK3 w - d6 0 1';
    const tracker = new Tracker(fen);
    tracker.addSquareEffect('d5', 'no_capture', 3, 'sanctuary', 'black');
    tracker.addSquareEffect('d3', 'no_capture', 3, 'sanctuary', 'black');
    expect(moveBlock(fen, tracker, 'd1d5')).toEqual({ square: 'd5', reason: 'no_capture' });
    expect(moveBlock(fen, tracker, 'e5d6')).toEqual({ square: 'd5', reason: 'no_capture' });
    expect(moveBlock(fen, tracker, 'd1d4')).toBeNull();
    expect(moveBlock(fen, tracker, 'd1d3')).toBeNull();
  });

  it('durata: due turni di chi non lancia; il clone è indipendente', () => {
    const tracker = new Tracker('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    tracker.addSquareEffect('e4', 'wall', 2, 'ice_wall', 'white');
    const clone = tracker.clone();
    expect([tracker.tickSquares('white'), tracker.tickSquares('black'), tracker.tickSquares('white'), tracker.tickSquares('black')]).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(tracker.squareEffects()).toEqual([]);
    expect(clone.hasSquareEffect('e4', 'wall')).toBe(true);
  });
});
