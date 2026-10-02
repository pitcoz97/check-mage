import { maxCopies, type Rarity } from '../game/catalog';

/**
 * Porting di `spells/collection.go` e `db/collection.go`: la collezione di carte per utente, in memoria. Il set
 * iniziale arriva alla prima lettura (C5).
 */

export interface CollectionSpell {
  readonly id: string;
  readonly mana_cost: number;
  readonly rarity: Rarity;
}

export interface CollectionEntry {
  readonly spell_id: string;
  readonly copies: number;
  readonly max_copies: number;
}

export interface CollectionView {
  readonly cards: readonly CollectionEntry[];
  readonly owned: number;
  readonly total: number;
}

/** `StarterCopies`: comuni al massimo, rare a 1, leggendarie a 0 (C4). */
export function starterCopies(rarity: Rarity): number {
  if (rarity === 'common') return maxCopies(rarity);
  return rarity === 'rare' ? 1 : 0;
}

/** `StarterSet`: solo le magie con almeno una copia. */
export function starterSet(catalog: readonly CollectionSpell[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const spell of catalog) {
    const copies = starterCopies(spell.rarity);
    if (copies > 0) out.set(spell.id, copies);
  }
  return out;
}

/** `Collection`: ogni magia nell'ordine di `GET /spells`, copie fra 0 e il massimo; le voci fuori catalogo si ignorano (C6). */
export function collectionView(catalog: readonly CollectionSpell[], owned: ReadonlyMap<string, number>): CollectionView {
  const sorted = [...catalog].sort((a, b) => a.mana_cost - b.mana_cost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cards = sorted.map((spell) => {
    const max = maxCopies(spell.rarity);
    return { spell_id: spell.id, copies: Math.min(Math.max(owned.get(spell.id) ?? 0, 0), max), max_copies: max };
  });
  return {
    cards,
    owned: cards.reduce((sum, card) => sum + card.copies, 0),
    total: cards.reduce((sum, card) => sum + card.max_copies, 0),
  };
}

/** `FullCollection`: ogni magia al massimo di copie. */
export function fullCollection(catalog: readonly CollectionSpell[]): Map<string, number> {
  return new Map(catalog.map((spell) => [spell.id, maxCopies(spell.rarity)]));
}

export function createCollectionStore(catalog: readonly CollectionSpell[], unlockAll = false) {
  const byUser = new Map<number, Map<string, number>>();
  const full = fullCollection(catalog);
  /** `LoadCollection`: assegna il set iniziale se l'utente non ha ancora righe, poi legge. */
  const owned = (userId: number): ReadonlyMap<string, number> => {
    let current = byUser.get(userId);
    if (current === undefined) {
      current = starterSet(catalog);
      byUser.set(userId, current);
    }
    // `ownedCopies` (C12): con la collezione piena le copie vere restano, ma non contano.
    return unlockAll ? full : current;
  };
  return {
    owned,
    /** Le copie salvate davvero, anche con la collezione piena (esportazione, P5). */
    saved(userId: number): ReadonlyMap<string, number> {
      owned(userId);
      return byUser.get(userId) ?? new Map();
    },
    /** Collezione dell'utente cancellato (P3). */
    removeUser(userId: number): void {
      byUser.delete(userId);
    },
    load(userId: number): CollectionView {
      return collectionView(catalog, owned(userId));
    },
  };
}

export type CollectionStore = ReturnType<typeof createCollectionStore>;
