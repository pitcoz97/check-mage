import { describe, expect, it } from 'vitest';

import { cardRefusal, type CastContext } from './playability';
import type { Spell } from './schema';
import { targetSpec, testSpell } from '../testing/catalog';

/** Abilitazione delle carte: mana e fase (test obbligatorio da CLAUDE.md), più turno, connessione e ignoto. */

const FROST: Spell = testSpell({ id: 'frost', manaCost: 2 });

const ok: CastContext = { playing: true, connected: true, myTurn: true, phase: 'main1', mana: 5, castPending: false };
const refusal = (context: Partial<CastContext>, spell: Spell | undefined = FROST) => cardRefusal(spell, { ...ok, ...context });

describe('giocabilità di una carta', () => {
  it('con turno, fase e mana la carta si può lanciare', () => {
    expect(refusal({})).toBeNull();
    expect(refusal({ phase: 'main2' })).toBeNull();
    expect(refusal({ mana: 2 })).toBeNull();
  });

  it('mana insufficiente e fase sbagliata hanno motivi distinti', () => {
    expect(refusal({ mana: 1 })).toBe('insufficient_mana');
    expect(refusal({ phase: 'move' })).toBe('wrong_phase');
    expect(refusal({ phase: 'draw' })).toBe('wrong_phase');
    expect(refusal({ phase: 'unknown' })).toBe('wrong_phase');
  });

  it('fuori turno, partita ferma o socket chiuso: il motivo lo dice', () => {
    expect(refusal({ myTurn: false })).toBe('not_your_turn');
    expect(refusal({ playing: false })).toBe('not_playing');
    expect(refusal({ connected: false })).toBe('not_connected');
  });

  it('un cast già in volo blocca il secondo, ma solo dopo gli altri controlli', () => {
    expect(refusal({ castPending: true })).toBe('cast_pending');
    expect(refusal({ castPending: true, mana: 0 })).toBe('insufficient_mana');
  });

  it('magia assente dal catalogo o bersaglio non gestito: carta visibile ma bloccata', () => {
    expect(cardRefusal(undefined, ok)).toBe('unknown_spell');
    expect(refusal({}, { ...FROST, targets: [targetSpec('constellation')] })).toBe('unsupported_target');
  });

  it('il turno conta prima della fase, come sul server', () => {
    expect(refusal({ myTurn: false, phase: 'move' })).toBe('not_your_turn');
  });
});
