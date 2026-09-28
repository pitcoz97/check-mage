import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';

import { normalizeSpellCatalog } from '../../api/adapter';
import type { CardCollection } from '../../api/types';
import { initI18n } from '../../i18n';
import { createWebStorage } from '../../lib/storage';
import fallbackCatalog from '../../spells/fallback.json';
import { collectionItems, DEFAULT_FILTERS, visibleItems, type CollectionFilters, type CollectionItem } from './collectionView';

const spells = normalizeSpellCatalog(fallbackCatalog).spells;
const byId = new Map(spells.map((spell) => [spell.id, spell]));

/** Il set iniziale del server (comuni 2, rare 1, leggendarie 0) più una voce che il catalogo non conosce. */
const COLLECTION: CardCollection = {
  cards: [
    ...spells.map((spell) => ({
      spellId: spell.id,
      copies: spell.rarity === 'common' ? 2 : spell.rarity === 'rare' ? 1 : 0,
      maxCopies: spell.rarity === 'legendary' ? 1 : 2,
    })),
    { spellId: 'future_spell', copies: 1, maxCopies: 2 },
  ],
  owned: 45,
  total: 59,
};

let items: CollectionItem[] = [];
const view = (filters: Partial<CollectionFilters>) => visibleItems(items, { ...DEFAULT_FILTERS, ...filters }, 'it').map((item) => item.spell.id);

beforeAll(async () => {
  await initI18n(createWebStorage(() => undefined));
  items = collectionItems(i18next.t, COLLECTION, byId);
});

describe('collezione: voci, filtri e ordinamenti', () => {
  it('le voci fuori catalogo si scartano; nome e testo tradotti', () => {
    expect(items).toHaveLength(32);
    expect(items.find((item) => item.spell.id === 'frost')).toMatchObject({ name: 'Brina', copies: 2, maxCopies: 2 });
  });

  it('di default per costo e poi per nome', () => {
    const ids = view({});
    expect(ids).toHaveLength(32);
    expect(ids[0]).toBe('blood_pact');
    expect(ids.at(-1)).toBe('resurrection');
    const costs = ids.map((id) => byId.get(id)?.manaCost ?? -1);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('rarità, costo esatto e 7+, solo possedute', () => {
    expect(view({ rarity: 'legendary' })).toEqual(['haste', 'early_promotion', 'minefield', 'eternal_winter', 'resurrection']);
    expect(view({ rarity: 'rare' })).toHaveLength(9);
    expect(view({ cost: 0 })).toEqual(['blood_pact']);
    expect(view({ cost: 7 })).toEqual(['minefield', 'eternal_winter', 'resurrection']);
    expect(view({ ownedOnly: true })).toHaveLength(27);
    expect(view({ ownedOnly: true, rarity: 'legendary' })).toEqual([]);
  });

  it('ricerca su nome e testo, senza maiuscole né accenti', () => {
    expect(view({ query: 'BRINA' })).toEqual(['frost']);
    expect(view({ query: '  brina ' })).toEqual(['frost']);
    // "perché" non compare, ma la ricerca piega gli accenti: "attraversa" trova il testo di Passo sfasato.
    expect(view({ query: 'attraversa' })).toContain('phase_step');
    expect(view({ query: 'zzz' })).toEqual([]);
  });

  it('per nome e per rarità (leggendarie, rare, comuni; poi costo)', () => {
    const names = visibleItems(items, { ...DEFAULT_FILTERS, sort: 'name' }, 'it').map((item) => item.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'it')));
    const byRarity = view({ sort: 'rarity' });
    expect(byRarity.slice(0, 5)).toEqual(['haste', 'early_promotion', 'minefield', 'eternal_winter', 'resurrection']);
    expect(byId.get(byRarity[5] ?? '')?.rarity).toBe('rare');
    expect(byId.get(byRarity.at(-1) ?? '')?.rarity).toBe('common');
  });
});
