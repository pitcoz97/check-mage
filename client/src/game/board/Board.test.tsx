// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initI18n } from '../../i18n';
import { createWebStorage } from '../../lib/storage';
import type { Square } from '../model';
import { Board } from './Board';
import type { BoardContext } from './selection';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PROMOTION = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
const CHECK = '4k3/8/8/8/8/8/8/4R1K1 b - - 0 1';

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});
afterEach(cleanup);

function context(overrides: Partial<BoardContext> = {}): BoardContext {
  return { fen: START, myColor: 'white', activePlayer: 'white', phase: 'move', frozen: new Set<Square>(), canAct: true, ...overrides };
}

function setup(overrides: { context?: Partial<BoardContext>; orientation?: 'white' | 'black'; optimistic?: { from: Square; to: Square } } = {}) {
  const onMove = vi.fn();
  const onRefused = vi.fn();
  const view = render(
    <Board
      context={context(overrides.context)}
      orientation={overrides.orientation ?? 'white'}
      lastMove={{ from: 'e2', to: 'e4' }}
      optimistic={overrides.optimistic ?? null}
      onMove={onMove}
      onRefused={onRefused}
    />,
  );
  const square = (name: string) => view.container.querySelector(`[data-square="${name}"]`) as HTMLButtonElement;
  return { view, onMove, onRefused, square };
}

describe('Board', () => {
  it('disegna la posizione del server e orienta la scacchiera dalla parte del giocatore', () => {
    const { view, square } = setup();
    expect(view.container.querySelectorAll('[data-square]')).toHaveLength(64);
    expect(square('e1').getAttribute('aria-label')).toBe('e1, re Bianco');
    expect(square('d8').getAttribute('aria-label')).toBe('d8, donna Nero');
    expect(square('e4').getAttribute('aria-label')).toBe('e4');
    // Il bianco vede a8 in alto a sinistra, il nero h1.
    const firstSquare = (container: HTMLElement) => container.querySelector('[data-square]')?.getAttribute('data-square');
    expect(firstSquare(view.container)).toBe('a8');
    cleanup();
    expect(firstSquare(setup({ orientation: 'black' }).view.container)).toBe('h1');
  });

  it('tap-tap: seleziona, evidenzia i bersagli e manda la mossa', () => {
    const { onMove, square, view } = setup();
    fireEvent.click(square('e2'));
    expect(square('e2').dataset['selected']).toBe('true');
    expect(view.container.querySelectorAll('[data-target="true"]')).toHaveLength(2);
    fireEvent.click(square('e4'));
    expect(onMove).toHaveBeenCalledWith('e2', 'e4', false);
  });

  it('un tap rifiutato porta il motivo, e il secondo tap altrove deseleziona', () => {
    const { onRefused, square } = setup({ context: { phase: 'main1' } });
    fireEvent.click(square('e2'));
    expect(onRefused).toHaveBeenCalledWith('wrong_phase');
    cleanup();

    const frozen = setup({ context: { frozen: new Set<Square>(['e2']) } });
    fireEvent.click(frozen.square('e2'));
    expect(frozen.onRefused).toHaveBeenCalledWith('piece_frozen');
    cleanup();

    const normal = setup();
    fireEvent.click(normal.square('e2'));
    fireEvent.click(normal.square('h6'));
    expect(normal.square('e2').dataset['selected']).toBe('false');
    expect(normal.onMove).not.toHaveBeenCalled();
  });

  it('drag: rilascio su un bersaglio manda la mossa, rilascio sulla stessa casella lascia la selezione', () => {
    const { onMove, square } = setup();
    const target = square('e4');
    // jsdom non implementa elementFromPoint: lo si definisce per simulare il rilascio sopra una casella.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    fireEvent.pointerDown(square('e2'), { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(square('e2'), { clientX: 7, clientY: 7 });
    fireEvent.pointerUp(square('e2'), { clientX: 7, clientY: 7 });
    expect(onMove).toHaveBeenCalledWith('e2', 'e4', false);
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  it('promozione segnalata al contenitore', () => {
    const { onMove, square } = setup({ context: { fen: PROMOTION } });
    fireEvent.click(square('a7'));
    fireEvent.click(square('a8'));
    expect(onMove).toHaveBeenCalledWith('a7', 'a8', true);
  });

  it('anteprima della propria mossa: il pezzo si vede già a destinazione', () => {
    const { square } = setup({ optimistic: { from: 'e2', to: 'e4' } });
    expect(square('e2').getAttribute('aria-label')).toBe('e2');
    expect(square('e4').getAttribute('aria-label')).toBe('e4, pedone Bianco');
  });

  it('il re sotto scacco è evidenziato', () => {
    const { square } = setup({ context: { fen: CHECK, myColor: 'black', activePlayer: 'black' } });
    expect(square('e8').className).toContain('var(--board-check)');
    expect(square('e1').className).not.toContain('var(--board-check)');
  });
});
