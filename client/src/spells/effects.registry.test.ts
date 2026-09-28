import i18next, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ActiveEffect } from '../game/model';
import { initI18n } from '../i18n';
import { createWebStorage } from '../lib/storage';
import {
  auraIcon,
  auraName,
  effectPresentation,
  effectStatePresentation,
  runeName,
  spellRulesText,
  stateLabel,
  statePresentation,
  triggerIcon,
} from './effects.registry';

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

describe('registry degli effetti: trigger e aure', () => {
  it('testi delle carte da on/do/grant, icone da do/grant, valori ignoti neutri', () => {
    expect(spellRulesText(t, [{ kind: 'add_trigger', params: { on: 'own_piece_lost', do: 'draw_card', amount: 1, duration: 1 } }])).toEqual([
      'Fino alla fine del prossimo turno avversario, ogni tuo pezzo perso ti fa pescare una carta.',
    ]);
    expect(spellRulesText(t, [{ kind: 'add_trigger', params: { on: 'shielded_piece_attacked', do: 'freeze_attacker' } }])[0]).toContain(
      'Trappola nascosta',
    );
    expect(spellRulesText(t, [{ kind: 'add_trigger', params: { on: 'moon', do: 'howl' } }])).toEqual(['Una reazione che scatta durante la partita.']);
    expect(spellRulesText(t, [{ kind: 'add_aura', params: { condition: { own_pawns_gte: 6 }, grant: 'pawn_sidestep', duration: -1 } }])).toEqual([
      'Con 6 o più pedoni, i tuoi pedoni possono muovere di una casa di lato.',
    ]);
    expect([triggerIcon('draw_card'), triggerIcon('freeze_attacker'), triggerIcon('howl')]).toEqual(['card', 'frost', 'question']);
    expect([auraIcon('pawn_sidestep'), auraIcon('flight')]).toEqual(['arrow', 'question']);
    expect(auraName(t, 'pawn_sidestep')).toBe('Stendardo');
    expect(auraName(t, 'flight')).toBe('Effetti del giocatore');
  });
});

describe('registry degli effetti: mosse speciali', () => {
  it('testi dai params, scelta dal cimitero, stati del pezzo', () => {
    expect(spellRulesText(t, [{ kind: 'add_effect', params: { effect: 'phasing', no_capture: true, duration: 0 } }])[0]).toContain('attraversa i pezzi');
    expect(spellRulesText(t, [{ kind: 'borrow_movement', params: { from_graveyard: ['knight', 'bishop'] } }])[0]).toContain('cavallo o alfiere');
    expect(spellRulesText(t, [{ kind: 'extra_move', params: { pieces: ['pawn'], no_capture: true } }])).toEqual([
      'Dopo la tua mossa puoi muovere anche un pedone, senza catturare.',
    ]);
    const borrow = effectPresentation('borrow_movement');
    expect(borrow.choiceOptions?.({ from_graveyard: ['knight', 'bishop'] }, { graveyard: ['knight', 'bishop', 'pawn'] })).toEqual(['knight', 'bishop']);
    expect(borrow.choiceOptions?.({ from_graveyard: ['knight', 'bishop'] }, { graveyard: ['bishop'] })).toBeNull();
    expect(statePresentation('phasing').label(t)).toBe('Sfasato');
    expect(statePresentation('borrow_movement').label(t)).toBe('Eco del caduto');
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
