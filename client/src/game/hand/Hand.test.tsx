// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initI18n } from '../../i18n';
import { createWebStorage } from '../../lib/storage';
import type { CastContext } from '../../spells/playability';
import type { Spell } from '../../spells/schema';
import type { HandCard } from '../model';
import { Hand } from './Hand';

/** La mano: cosa si può giocare, cosa è disabilitato e col motivo, e cosa succede al tap. */

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
});
afterEach(cleanup);

const CATALOG: Record<string, Spell> = {
  frostbolt: {
    id: 'frostbolt',
    name: 'Frost Bolt',
    manaCost: 2,
    phases: ['main1', 'main2'],
    targetType: 'enemy_piece',
    effects: [{ kind: 'freeze_piece', params: { turns: 2 } }],
  },
  nova: { id: 'nova', name: 'Nova', manaCost: 5, phases: ['main1', 'main2'], targetType: 'none', effects: [{ kind: 'noop', params: {} }] },
};

const CARDS: readonly HandCard[] = [
  { instanceId: 'c1', spellId: 'frostbolt' },
  { instanceId: 'c2', spellId: 'nova' },
  { instanceId: 'c3', spellId: 'meteora' },
];

const context: CastContext = { playing: true, connected: true, myTurn: true, phase: 'main1', mana: 3, castPending: false };

function setup(overrides: Partial<CastContext> = {}, selectedInstanceId: string | null = null) {
  const onPick = vi.fn();
  render(
    <Hand
      cards={CARDS}
      spellOf={(id) => CATALOG[id]}
      context={{ ...context, ...overrides }}
      selectedInstanceId={selectedInstanceId}
      onPick={onPick}
    />,
  );
  const card = (spellId: string) => document.querySelector(`[data-card="${spellId}"]`) as HTMLButtonElement;
  return { onPick, card };
}

describe('mano', () => {
  it('la carta giocabile ha il testo di regole dal catalogo e avvia il cast', () => {
    const { onPick, card } = setup();
    expect(card('frostbolt').dataset['playable']).toBe('true');
    expect(card('frostbolt').textContent).toContain('Frost Bolt');
    expect(card('frostbolt').textContent).toContain('Congela un pezzo avversario per 2 turni');
    fireEvent.click(card('frostbolt'));
    expect(onPick).toHaveBeenCalledWith(CARDS[0], CATALOG['frostbolt']);
  });

  it('mana insufficiente: carta visibile, disabilitata e col motivo', () => {
    const { onPick, card } = setup();
    expect(card('nova').disabled).toBe(true);
    expect(card('nova').textContent).toContain('Servono 5 mana');
    fireEvent.click(card('nova'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('fase sbagliata: tutte disabilitate, con il motivo giusto', () => {
    const { card } = setup({ phase: 'move' });
    expect(card('frostbolt').disabled).toBe(true);
    expect(card('frostbolt').textContent).toContain('Non puoi lanciare magie in questa fase');
  });

  it('una magia che il catalogo non conosce si vede lo stesso, col suo id', () => {
    const { card } = setup();
    expect(card('meteora').textContent).toContain('meteora');
    expect(card('meteora').textContent).toContain('Magia sconosciuta a questo client');
    expect(card('meteora').disabled).toBe(true);
  });

  it('la carta in corso di bersaglio è segnata', () => {
    const { card } = setup({}, 'c1');
    expect(card('frostbolt').dataset['selected']).toBe('true');
    expect(card('nova').dataset['selected']).toBe('false');
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
