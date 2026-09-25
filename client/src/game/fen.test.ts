import { describe, expect, it } from 'vitest';

import { coordinateLabels, piecesOf, squaresInOrder } from './fen';

/** Lettura della FEN per il rendering: nessuna regola, solo il formato. */

describe('piecesOf', () => {
  it('legge la posizione iniziale', () => {
    const pieces = piecesOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(pieces).toHaveLength(32);
    expect(pieces).toContainEqual({ square: 'e1', color: 'white', kind: 'king' });
    expect(pieces).toContainEqual({ square: 'd8', color: 'black', kind: 'queen' });
  });

  it('accetta posizioni che le regole non ammettono (le magie ne producono)', () => {
    expect(piecesOf('8/8/8/8/8/8/8/K7 w - - 0 1')).toEqual([{ square: 'a1', color: 'white', kind: 'king' }]);
  });

  it.each(['', 'non una fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w', 'rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w', 'xnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'])(
    'FEN illeggibile "%s" → nessun pezzo',
    (fen) => {
      expect(piecesOf(fen)).toEqual([]);
    },
  );
});

describe('coordinateLabels', () => {
  it('seguono l’orientamento', () => {
    const at = (orientation: 'white' | 'black', index: number) => {
      const square = squaresInOrder(orientation)[index];
      if (square === undefined) throw new Error('indice fuori scacchiera');
      return coordinateLabels(square, index);
    };
    expect(at('white', 56)).toEqual({ rankLabel: '1', fileLabel: 'a' });
    expect(at('black', 56)).toEqual({ rankLabel: '8', fileLabel: 'h' });
    expect(at('white', 9)).toEqual({ rankLabel: null, fileLabel: null });
  });
});
