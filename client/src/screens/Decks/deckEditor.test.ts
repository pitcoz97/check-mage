import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';

import { normalizeSpellCatalog } from '../../api/adapter';
import type { Deck } from '../../api/types';
import { initI18n } from '../../i18n';
import { createWebStorage } from '../../lib/storage';
import fallbackCatalog from '../../spells/fallback.json';
import { collectionItems, type CollectionItem } from '../Collection/collectionView';
import {
  addCard,
  archetypes,
  autofill,
  byRecency,
  copyCap,
  deckRows,
  deckSigil,
  deckTotal,
  isDirty,
  manaCurve,
  nameValid,
  poolState,
  removeCard,
} from './deckEditor';

const spells = normalizeSpellCatalog(fallbackCatalog).spells;
const byId = new Map(spells.map((spell) => [spell.id, spell]));
let items: CollectionItem[] = [];
const item = (id: string) => items.find((i) => i.spell.id === id) as CollectionItem;

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
  items = collectionItems(
    i18next.t,
    {
      cards: spells.map((s) => ({
        spellId: s.id,
        copies: s.rarity === 'common' ? 2 : s.rarity === 'rare' ? 1 : 0,
        maxCopies: s.rarity === 'legendary' ? 1 : 2,
      })),
      owned: 45,
      total: 59,
    },
    byId,
  );
});

describe('editor dei mazzi', () => {
  it('cap per carta: rarità e copie possedute; stati della griglia', () => {
    expect(copyCap(item('frost'))).toBe(2);
    expect(copyCap(item('shatter'))).toBe(1);
    expect(copyCap(item('haste'))).toBe(0);
    let cards: ReadonlyMap<string, number> = new Map();
    cards = addCard(addCard(addCard(cards, item('frost'), 40), item('frost'), 40), item('frost'), 40);
    expect(cards.get('frost')).toBe(2);
    expect(poolState(item('frost'), cards, 40)).toBe('max');
    expect(poolState(item('haste'), cards, 40)).toBe('locked');
    expect(poolState(item('shield'), cards, 2)).toBe('full');
    expect(addCard(cards, item('shield'), 2)).toBe(cards);
    expect(removeCard(removeCard(cards, 'frost'), 'frost').has('frost')).toBe(false);
  });

  it('autocompleta dalla più economica fino a 40; non supera il posseduto', () => {
    const full = autofill(new Map(), items, 40, 'it');
    expect(deckTotal(full)).toBe(40);
    expect(full.get('blood_pact')).toBe(2);
    expect(full.has('haste')).toBe(false);
    for (const [id, n] of full) expect(n).toBeLessThanOrEqual(copyCap(item(id)));
    expect(autofill(full, items, 40, 'it')).toEqual(full);
  });

  it('righe, curva, costo medio, archetipi e sigillo', () => {
    const cards = new Map([
      ['frost', 2],
      ['ice_wall', 1],
      ['shield', 1],
      ['eternal_winter', 0],
    ]);
    expect(deckRows(cards, items, 'it').map((r) => [r.item.spell.id, r.count])).toEqual([
      ['frost', 2],
      ['ice_wall', 1],
      ['shield', 1],
    ]);
    const { buckets, average } = manaCurve(cards, byId);
    expect(buckets).toEqual([0, 2, 2, 0, 0, 0, 0, 0]);
    expect(average).toBe(1.5);
    expect(manaCurve(new Map(), byId).average).toBeNull();
    expect(archetypes(cards, byId)).toEqual([
      { tag: 'gelo', count: 3 },
      { tag: 'sacro', count: 1 },
    ]);
    expect(deckSigil(cards, byId)).toBe('frost');
    expect(deckSigil(new Map([['shield', 2]]), byId)).toBe('gold');
    expect(deckSigil(new Map(), byId)).toBe('arcane');
  });

  it('modifiche non salvate, nome, ordine per recenza', () => {
    const saved: Deck = { id: '1', name: 'Gelo', cards: new Map([['frost', 2]]), size: 2, valid: false, active: false, updatedAt: '2026-09-20T10:00:00Z' };
    expect(isDirty({ name: ' Gelo ', cards: new Map([['frost', 2]]) }, saved)).toBe(false);
    expect(isDirty({ name: 'Gelo', cards: new Map([['frost', 1]]) }, saved)).toBe(true);
    expect(isDirty({ name: 'Brina', cards: saved.cards }, saved)).toBe(true);
    expect(nameValid('  ')).toBe(false);
    expect(nameValid('x'.repeat(25))).toBe(false);
    const decks = [saved, { ...saved, id: '2', updatedAt: '2026-09-25T10:00:00Z' }, { ...saved, id: '3', active: true }];
    expect(byRecency(decks).map((d) => d.id)).toEqual(['3', '2', '1']);
  });
});
