import i18next, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ActiveEffect } from '../game/model';
import { initI18n } from '../i18n';
import { createWebStorage } from '../lib/storage';
import { effectPresentation, effectStatePresentation, runeName, spellRulesText, stateLabel, statePresentation } from './effects.registry';

let t: TFunction;
beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
  t = i18next.t.bind(i18next);
});

const rune = (overrides: Partial<ActiveEffect> = {}): ActiveEffect => ({
  kind: 'rune',
  remainingTurns: -1,
  sourceSpellId: 'stasis_rune',
  owner: 'white',
  hidden: true,
  onEnter: 'freeze_piece',
  ...overrides,
});

describe('registry degli stati: rune', () => {
  it('icona e nome da on_enter, senza switch sulla magia', () => {
    expect(effectStatePresentation(rune()).badge).toBe('frost');
    expect(effectStatePresentation(rune({ onEnter: 'return_to_origin' })).badge).toBe('return');
    expect(effectStatePresentation(rune({ onEnter: 'destroy_piece' })).badge).toBe('burst');
    expect(effectStatePresentation(rune({ onEnter: 'teleport' })).badge).toBe('rune');
    expect(runeName(t, 'destroy_piece')).toBe('Runa esplosiva');
    expect(runeName(t, undefined)).toBe('Runa');
  });

  it('la propria runa nascosta è tratteggiata e semitrasparente, una runa visibile è piena', () => {
    expect(effectStatePresentation(rune()).veil).toContain('border-dashed');
    expect(effectStatePresentation(rune()).veil).toContain('opacity-60');
    expect(effectStatePresentation(rune({ hidden: false })).veil).not.toContain('border-dashed');
    // Gli altri stati non cambiano.
    expect(effectStatePresentation({ kind: 'freeze', remainingTurns: 1, sourceSpellId: null })).toBe(statePresentation('freeze'));
  });

  it('etichette: di chi è la runa e se l’avversario la vede; niente turni per gli stati permanenti', () => {
    expect(stateLabel(t, rune(), 'white')).toBe('Runa di stasi tua, visibile solo a te');
    expect(stateLabel(t, rune({ hidden: false }), 'white')).toBe('Runa di stasi tua');
    expect(stateLabel(t, rune({ owner: 'black', hidden: false, onEnter: 'return_to_origin' }), 'white')).toBe('Runa di respinta dell’avversario');
    expect(stateLabel(t, { kind: 'freeze', remainingTurns: 2, sourceSpellId: null }, 'white')).toBe('Congelato, ancora 2 turni');
  });
});

describe('registry degli effetti: rune', () => {
  it('testi delle carte dai params', () => {
    expect(spellRulesText(t, [{ kind: 'place_rune', params: { on_enter: 'freeze_piece', duration: 2 } }])).toEqual([
      'Una runa nascosta: il pezzo nemico che ci entra è congelato per 2 suoi turni.',
    ]);
    expect(spellRulesText(t, [{ kind: 'place_rune', params: { on_enter: 'destroy_piece', only: ['pawn', 'knight', 'bishop'] } }])).toEqual([
      'Una runa nascosta: distrugge il pedone, cavallo o alfiere nemico che ci entra; gli altri pezzi restano congelati.',
    ]);
    expect(spellRulesText(t, [{ kind: 'detonate_runes', params: { duration: 1 } }])[0]).toContain('prossimo turno');
    expect(effectPresentation('hidden_effect').label(t)).toBe('Effetto nascosto');
  });
});
