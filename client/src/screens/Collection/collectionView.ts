import type { TFunction } from 'i18next';

import type { CardCollection } from '../../api/types';
import type { SpellId } from '../../game/model';
import type { Rarity, Spell } from '../../spells/schema';
import { spellName, spellText } from '../../spells/texts';

/**
 * Logica pura della Collezione: le voci del server unite al catalogo, i filtri e gli ordinamenti del design. Nessun
 * ramo per magia: nome e testo arrivano dall'i18n per id (`spells/texts.ts`).
 */

export interface CollectionItem {
  readonly spell: Spell;
  readonly copies: number;
  readonly maxCopies: number;
  /** Nome e testo tradotti: servono alla ricerca e all'ordinamento per nome. */
  readonly name: string;
  readonly text: string;
}

export type RarityFilter = 'all' | Rarity;
export type SortKey = 'cost' | 'name' | 'rarity';

/** Chip di costo: `null` = tutti; l'ultimo vale "7 o più" (il catalogo arriva a 8). */
export const COST_CHIPS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export type CostChip = (typeof COST_CHIPS)[number];
export const COST_OPEN_END: CostChip = 7;

export const RARITY_FILTERS: readonly RarityFilter[] = ['all', 'common', 'rare', 'legendary'];
export const SORT_KEYS: readonly SortKey[] = ['cost', 'name', 'rarity'];

export interface CollectionFilters {
  readonly rarity: RarityFilter;
  readonly cost: CostChip | null;
  readonly ownedOnly: boolean;
  readonly query: string;
  readonly sort: SortKey;
}

export const DEFAULT_FILTERS: CollectionFilters = { rarity: 'all', cost: null, ownedOnly: false, query: '', sort: 'cost' };

/** Leggendarie prima, come la "mitica" del design. */
const RARITY_ORDER: Record<Rarity, number> = { legendary: 0, rare: 1, common: 2 };

/** Le voci della collezione con la loro magia; una voce che il catalogo non conosce si scarta. */
export function collectionItems(t: TFunction, collection: CardCollection, byId: ReadonlyMap<SpellId, Spell>): CollectionItem[] {
  const items: CollectionItem[] = [];
  for (const card of collection.cards) {
    const spell = byId.get(card.spellId);
    if (spell === undefined) continue;
    items.push({
      spell,
      copies: card.copies,
      maxCopies: card.maxCopies,
      name: spellName(t, spell, spell.id),
      text: spellText(t, spell, spell.id).join(' '),
    });
  }
  return items;
}

/** Minuscole e senza accenti: "perche" trova "perché". */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}

function matchesCost(cost: number, chip: CostChip | null): boolean {
  if (chip === null) return true;
  return chip === COST_OPEN_END ? cost >= COST_OPEN_END : cost === chip;
}

export function visibleItems(items: readonly CollectionItem[], filters: CollectionFilters, locale: string): CollectionItem[] {
  const query = fold(filters.query.trim());
  const byName = (a: CollectionItem, b: CollectionItem) => a.name.localeCompare(b.name, locale);
  const byCost = (a: CollectionItem, b: CollectionItem) => a.spell.manaCost - b.spell.manaCost;
  const compare: Record<SortKey, (a: CollectionItem, b: CollectionItem) => number> = {
    cost: (a, b) => byCost(a, b) || byName(a, b),
    name: byName,
    rarity: (a, b) => RARITY_ORDER[a.spell.rarity] - RARITY_ORDER[b.spell.rarity] || byCost(a, b) || byName(a, b),
  };
  return items
    .filter(
      (item) =>
        (filters.rarity === 'all' || item.spell.rarity === filters.rarity) &&
        matchesCost(item.spell.manaCost, filters.cost) &&
        (!filters.ownedOnly || item.copies > 0) &&
        (query === '' || fold(`${item.name} ${item.text}`).includes(query)),
    )
    .sort(compare[filters.sort]);
}
