import { describe, expect, it } from 'vitest';

import { isLightSquare, kingInCheckSquare, legalTargets, needsPromotion, piecesOf, squaresInOrder, toUci } from './position';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('position', () => {
  it('piecesOf: 32 pezzi all’inizio, con colore e tipo', () => {
    const pieces = piecesOf(START);
    expect(pieces).toHaveLength(32);
    expect(pieces.find((p) => p.square === 'e1')).toEqual({ square: 'e1', color: 'white', kind: 'king' });
    expect(pieces.find((p) => p.square === 'b8')).toEqual({ square: 'b8', color: 'black', kind: 'knight' });
  });

  it('una FEN illeggibile non fa esplodere niente', () => {
    for (const broken of ['', 'x']) {
      expect(piecesOf(broken)).toEqual([]);
      expect(legalTargets(broken, 'e2')).toEqual([]);
      expect(kingInCheckSquare(broken)).toBeNull();
      expect(needsPromotion(broken, 'e7', 'e8')).toBe(false);
    }
  });

  it('legalTargets: solo suggerimenti visivi', () => {
    expect(legalTargets(START, 'e2').sort()).toEqual(['e3', 'e4']);
    expect(legalTargets(START, 'g1').sort()).toEqual(['f3', 'h3']);
    expect(legalTargets(START, 'e4')).toEqual([]);
  });

  it('needsPromotion solo sull’ultima traversa', () => {
    const fen = '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1';
    expect(needsPromotion(fen, 'e7', 'e8')).toBe(false); // e8 è occupata dal re: mossa illegale
    expect(needsPromotion('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8')).toBe(true);
    expect(needsPromotion(START, 'e2', 'e4')).toBe(false);
  });

  it('kingInCheckSquare: il re del lato al tratto', () => {
    expect(kingInCheckSquare(START)).toBeNull();
    expect(kingInCheckSquare('4k3/8/8/8/8/8/8/R3K3 b - - 0 1')).toBeNull();
    expect(kingInCheckSquare('4k3/8/8/8/8/8/8/4R1K1 b - - 0 1')).toBe('e8');
  });

  it('squaresInOrder: il proprio lato in basso', () => {
    const white = squaresInOrder('white');
    expect([white[0], white.at(-1)]).toEqual(['a8', 'h1']);
    const black = squaresInOrder('black');
    expect([black[0], black.at(-1)]).toEqual(['h1', 'a8']);
    expect(white).toHaveLength(64);
  });

  it('colore delle caselle e notazione UCI', () => {
    expect([isLightSquare('a1'), isLightSquare('h1'), isLightSquare('e4'), isLightSquare('d4')]).toEqual([false, true, true, false]);
    expect(toUci('e2', 'e4')).toBe('e2e4');
    expect(toUci('e7', 'e8', 'q')).toBe('e7e8q');
  });
});
