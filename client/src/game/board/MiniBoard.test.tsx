// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MiniBoard } from './MiniBoard';

/** La miniatura della home: posizione e ultima mossa, nessuna interazione. */

afterEach(cleanup);

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('MiniBoard', () => {
  it("è un'immagine descritta, senza pulsanti", () => {
    render(<MiniBoard fen={AFTER_E4} orientation="white" label="Partita in corso" />);
    expect(screen.getByRole('img', { name: 'Partita in corso' })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it("disegna i pezzi della FEN, l'ultima mossa e l'orientamento", () => {
    const { container } = render(
      <MiniBoard fen={AFTER_E4} orientation="black" lastMove={{ from: 'e2', to: 'e4' }} label="Partita in corso" />,
    );
    const square = (name: string) => container.querySelector(`[data-square="${name}"]`);
    expect(container.querySelectorAll('[data-piece]')).toHaveLength(32);
    expect(square('e4')?.querySelector('[data-piece]')?.getAttribute('data-piece')).toBe('white-pawn');
    expect(square('e2')?.querySelector('[data-piece]')).toBeNull();
    expect(container.querySelector('[data-square]')?.getAttribute('data-square')).toBe('h1');
  });
});
