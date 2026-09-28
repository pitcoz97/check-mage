import { describe, expect, it } from 'vitest';

import { applySpecialMove } from './fen';
import { KIND_BORROW, KIND_PHASING, specialMoves } from './special';
import { Tracker } from './tracker';

/** Porting di `effects/special_test.go`. */

describe('mosse speciali (effects/special.go)', () => {
  it('phasing: attraverso i pezzi fino a case vuote, senza catturare; il muro ferma', () => {
    const fen = '4k3/8/8/8/8/2p5/1P6/B3K3 w - - 0 1';
    const tracker = new Tracker(fen);
    tracker.addMovementEffect('a1', KIND_PHASING, '', 'white', 0, 'phase_step');
    expect(specialMoves(fen, tracker, false)).toEqual(expect.arrayContaining(['a1d4', 'a1e5', 'a1h8']));
    expect(specialMoves(fen, tracker, false)).not.toContain('a1c3');
    tracker.addSquareEffect('f6', 'wall', 2, 'ice_wall', 'black');
    const walled = specialMoves(fen, tracker, false);
    expect(walled).toContain('a1e5');
    expect(walled).not.toContain('a1g7');
    expect(() => tracker.addMovementEffect('c3', KIND_PHASING, '', 'white', 0, 'phase_step')).toThrow();
  });

  it('movimento preso in prestito: catture ammesse, mai in ottava traversa', () => {
    const knight = '4k3/8/1P6/3p4/8/8/8/4K3 w - - 0 1';
    const tracker = new Tracker(knight);
    tracker.addMovementEffect('b6', KIND_BORROW, 'knight', 'white', 0, 'echo_of_fallen');
    const moves = specialMoves(knight, tracker, false);
    expect(moves).toEqual(expect.arrayContaining(['b6d5', 'b6d7', 'b6a4']));
    expect(moves).not.toContain('b6c8');
    expect(tracker.borrowedAs('b6')).toBe('knight');

    const bishop = '4k3/8/5n2/8/3P4/8/8/4K3 w - - 0 1';
    const t2 = new Tracker(bishop);
    t2.addMovementEffect('d4', KIND_BORROW, 'bishop', 'white', 0, 'echo_of_fallen');
    const slides = specialMoves(bishop, t2, false);
    expect(slides).toEqual(expect.arrayContaining(['d4e5', 'd4f6']));
    expect(slides).not.toContain('d4g7');
  });

  it('passo di lato solo su case vuote; niente che scopra il re o muova un pezzo congelato', () => {
    const fen = '4k3/8/8/8/4Pp2/8/8/4K3 w - - 0 1';
    expect(specialMoves(fen, new Tracker(fen), true)).toEqual(['e4d4']);
    expect(specialMoves(fen, new Tracker(fen), false)).toEqual([]);
    const pinned = '4r1k1/8/8/8/8/8/4P3/4K3 w - - 0 1';
    expect(specialMoves(pinned, new Tracker(pinned), true)).toEqual([]);
    const frozen = new Tracker(fen);
    frozen.freeze('e4', 'black', 1, 'frost');
    expect(specialMoves(fen, frozen, true)).toEqual([]);
  });

  it('ApplySpecialMove: tratto, en passant, contatori, arrocchi', () => {
    expect(applySpecialMove('4k3/8/8/8/4P3/8/8/4K3 w - e3 5 10', 'e4d4')).toBe('4k3/8/8/8/3P4/8/8/4K3 b - - 0 10');
    expect(applySpecialMove('4k3/8/8/8/8/8/8/B3K3 b - - 3 10', 'e8d8')?.endsWith(' w - - 4 11')).toBe(true);
    const capture = applySpecialMove('r3k3/8/8/8/8/8/8/B3K3 w q - 0 1', 'a1a8') ?? '';
    expect(capture.startsWith('B3k3/')).toBe(true);
    expect(capture.split(' ')[2]).toBe('-');
  });
});
