// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initI18n } from '../../i18n';
import { createWebStorage } from '../../lib/storage';
import type { CastContext } from '../../spells/playability';
import type { Spell } from '../../spells/schema';
import { testSpell } from '../../testing/catalog';
import type { HandCard } from '../model';
import { Hand } from './Hand';

/** La mano: struttura della carta, cosa si può giocare, cosa è spento e perché, ventaglio, annullo e anteprima. */

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});
afterEach(cleanup);

const CATALOG: Record<string, Spell> = {
  frostbolt: testSpell({ id: 'frostbolt', name: 'Frost Bolt', manaCost: 2, effects: [{ kind: 'freeze_piece', params: { duration: 2 } }] }),
  nova: testSpell({ id: 'nova', name: 'Nova', manaCost: 5, targets: [], effects: [{ kind: 'gain_mana', params: { amount: 2 } }] }),
};

const CARDS: readonly HandCard[] = [
  { instanceId: 'c1', spellId: 'frostbolt' },
  { instanceId: 'c2', spellId: 'nova' },
  { instanceId: 'c3', spellId: 'meteora' },
];

const context: CastContext = { playing: true, connected: true, myTurn: true, phase: 'main1', mana: 3, castPending: false };

function setup(overrides: Partial<CastContext> = {}, selectedInstanceId: string | null = null) {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const onRefused = vi.fn();
  render(
    <Hand
      cards={CARDS}
      spellOf={(id) => CATALOG[id]}
      context={{ ...context, ...overrides }}
      selectedInstanceId={selectedInstanceId}
      onPick={onPick}
      onCancel={onCancel}
      onRefused={onRefused}
    />,
  );
  const card = (spellId: string) => document.querySelector(`[data-card="${spellId}"]`) as HTMLButtonElement;
  return { onPick, onCancel, onRefused, card };
}

describe('mano', () => {
  it('la carta ha la struttura del design: costo, riga del tipo dal primo effetto, testo di regole dal catalogo', () => {
    const { card } = setup();
    const face = card('frostbolt');
    expect(face.querySelector('[data-card-name]')?.textContent).toBe('Frost Bolt');
    expect(face.querySelector('[data-card-cost]')?.textContent).toBe('2');
    expect(face.querySelector('[data-card-type]')?.textContent).toBe('Magia · Gelo');
    expect(face.querySelector('[data-card-rules]')?.textContent).toContain('Congela il pezzo: non può muoversi per 2 suoi turni.');
    // Rarità comune: cornice grigia (M14).
    expect(face.querySelector('[data-card-face]')?.className).toContain('border-rarity-common');
  });

  it("la carta giocabile avvia il cast, e l'etichetta dice nome, costo e regole", () => {
    const { onPick, card } = setup();
    expect(card('frostbolt').dataset['playable']).toBe('true');
    expect(card('frostbolt').getAttribute('aria-label')).toBe('Frost Bolt, costo 2. Congela il pezzo: non può muoversi per 2 suoi turni.');
    fireEvent.click(card('frostbolt'));
    expect(onPick).toHaveBeenCalledWith(CARDS[0], CATALOG['frostbolt']);
  });

  it('mana insufficiente: carta visibile e scurita, il motivo non è scritto sopra ma arriva al tocco (D5)', () => {
    const { onPick, onRefused, card } = setup();
    expect(card('nova').getAttribute('aria-disabled')).toBe('true');
    expect(card('nova').querySelector('[data-card-veil]')).not.toBeNull();
    expect(card('nova').textContent).not.toContain('Servono 5 mana');
    expect(card('nova').getAttribute('aria-label')).toContain('Servono 5 mana');
    fireEvent.click(card('nova'));
    expect(onRefused).toHaveBeenCalledWith('insufficient_mana', CATALOG['nova']);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('fase sbagliata: tutte spente, con il motivo giusto', () => {
    const { card } = setup({ phase: 'move' });
    expect(card('frostbolt').getAttribute('aria-disabled')).toBe('true');
    expect(card('frostbolt').getAttribute('aria-label')).toContain('Non puoi lanciare magie in questa fase');
  });

  it('una magia che il catalogo non conosce si vede lo stesso, col suo id e costo ignoto', () => {
    const { card, onRefused } = setup();
    expect(card('meteora').querySelector('[data-card-name]')?.textContent).toBe('meteora');
    expect(card('meteora').querySelector('[data-card-cost]')?.textContent).toBe('?');
    expect(card('meteora').getAttribute('aria-label')).toContain('Magia sconosciuta a questo client');
    fireEvent.click(card('meteora'));
    expect(onRefused).toHaveBeenCalledWith('unknown_spell', undefined);
  });

  it('la carta selezionata è segnata, e toccarla di nuovo annulla (D8)', () => {
    const { card, onCancel, onPick } = setup({}, 'c1');
    expect(card('frostbolt').dataset['selected']).toBe('true');
    expect(card('frostbolt').getAttribute('aria-pressed')).toBe('true');
    expect(card('nova').dataset['selected']).toBe('false');
    fireEvent.click(card('frostbolt'));
    expect(onCancel).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('ventaglio: ogni carta sa la sua distanza dal centro', () => {
    const { card } = setup();
    expect(['frostbolt', 'nova', 'meteora'].map((id) => card(id).style.getPropertyValue('--k'))).toEqual(['-1', '0', '1']);
    expect(document.querySelector<HTMLElement>('[data-hand]')?.style.getPropertyValue('--n')).toBe('3');
  });

  it('anteprima a grandezza piena: al passaggio del puntatore e alla pressione prolungata, che poi non seleziona', () => {
    vi.useFakeTimers();
    try {
      const { card, onPick } = setup();
      const preview = () => document.querySelector('[data-card-preview]');
      fireEvent.pointerEnter(card('frostbolt'), { pointerType: 'mouse' });
      expect(preview()?.textContent).toContain('Frost Bolt');
      fireEvent.pointerLeave(card('frostbolt'), { pointerType: 'mouse' });
      expect(preview()).toBeNull();

      fireEvent.pointerDown(card('frostbolt'), { pointerType: 'touch' });
      act(() => void vi.advanceTimersByTime(450));
      expect(preview()?.textContent).toContain('Frost Bolt');
      fireEvent.pointerUp(card('frostbolt'), { pointerType: 'touch' });
      fireEvent.click(card('frostbolt'));
      expect(preview()).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('senza carte lo dice, e mentre il catalogo arriva lo dice', () => {
    render(<Hand cards={[]} spellOf={() => undefined} context={context} selectedInstanceId={null} onPick={vi.fn()} />);
    expect(screen.getByText('Nessuna carta in mano.')).toBeTruthy();
    cleanup();
    render(<Hand cards={CARDS} spellOf={() => undefined} context={context} selectedInstanceId={null} loading onPick={vi.fn()} />);
    expect(screen.getByText('Caricamento del catalogo…')).toBeTruthy();
    expect(document.querySelector('[data-card]')).toBeNull();
  });
});
