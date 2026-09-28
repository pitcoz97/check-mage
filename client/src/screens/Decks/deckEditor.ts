import type { Deck } from '../../api/types';
import type { SpellId } from '../../game/model';
import type { Spell } from '../../spells/schema';
import type { CollectionItem } from '../Collection/collectionView';

/**
 * Logica pura dell'editor dei mazzi (tavole "Mazzi · desktop/Android"). La validità calcolata qui serve solo alla
 * presentazione (contatore, stato, pulsanti): decide il server (D1, D3).
 */

export type DeckCards = ReadonlyMap<string, number>;

export interface DeckDraft {
  readonly name: string;
  readonly cards: DeckCards;
}

export function deckTotal(cards: DeckCards): number {
  let n = 0;
  for (const c of cards.values()) n += c;
  return n;
}

/** Copie che il mazzo può contenere: il massimo della rarità, e mai più di quelle possedute (D1). */
export function copyCap(item: CollectionItem): number {
  return Math.min(item.maxCopies, item.copies);
}

/** Stato di una carta nella griglia: il badge del design. */
export type PoolState = 'available' | 'locked' | 'max' | 'full';

export function poolState(item: CollectionItem, cards: DeckCards, deckSize: number): PoolState {
  if (item.copies === 0) return 'locked';
  if ((cards.get(item.spell.id) ?? 0) >= copyCap(item)) return 'max';
  return deckTotal(cards) >= deckSize ? 'full' : 'available';
}

/** Una copia in più, se c'è posto; altrimenti le carte restano le stesse. */
export function addCard(cards: DeckCards, item: CollectionItem, deckSize: number): DeckCards {
  if (poolState(item, cards, deckSize) !== 'available') return cards;
  const next = new Map(cards);
  next.set(item.spell.id, (cards.get(item.spell.id) ?? 0) + 1);
  return next;
}

export function removeCard(cards: DeckCards, spellId: string): DeckCards {
  const n = cards.get(spellId) ?? 0;
  if (n <= 0) return cards;
  const next = new Map(cards);
  if (n === 1) next.delete(spellId);
  else next.set(spellId, n - 1);
  return next;
}

/** «Autocompleta» (D7): dalla carta posseduta più economica, a pari costo per nome, fino al mazzo pieno. */
export function autofill(cards: DeckCards, items: readonly CollectionItem[], deckSize: number, locale: string): DeckCards {
  const next = new Map(cards);
  let total = deckTotal(next);
  const ordered = [...items].sort((a, b) => a.spell.manaCost - b.spell.manaCost || a.name.localeCompare(b.name, locale));
  for (const item of ordered) {
    while (total < deckSize && (next.get(item.spell.id) ?? 0) < copyCap(item)) {
      next.set(item.spell.id, (next.get(item.spell.id) ?? 0) + 1);
      total++;
    }
  }
  return next;
}

/** Le righe del mazzo: per costo, poi per nome; le carte che il catalogo non conosce restano fuori. */
export function deckRows(cards: DeckCards, items: readonly CollectionItem[], locale: string): { item: CollectionItem; count: number }[] {
  return items
    .filter((item) => (cards.get(item.spell.id) ?? 0) > 0)
    .map((item) => ({ item, count: cards.get(item.spell.id) ?? 0 }))
    .sort((a, b) => a.item.spell.manaCost - b.item.spell.manaCost || a.item.name.localeCompare(b.item.name, locale));
}

/** Colonne della curva: 0, 1 … 6 e `7+` (D9). */
export const CURVE_BUCKETS = 8;

export function manaCurve(cards: DeckCards, byId: ReadonlyMap<SpellId, Spell>): { buckets: number[]; average: number | null } {
  const buckets = Array.from({ length: CURVE_BUCKETS }, () => 0);
  let sum = 0;
  let total = 0;
  for (const [id, n] of cards) {
    const spell = byId.get(id);
    if (spell === undefined) continue;
    const bucket = Math.min(spell.manaCost, CURVE_BUCKETS - 1);
    buckets[bucket] = (buckets[bucket] ?? 0) + n;
    sum += spell.manaCost * n;
    total += n;
  }
  return { buckets, average: total === 0 ? null : sum / total };
}

/** Archetipi del mazzo (il primo tag di ogni carta) col numero di carte, dal più presente (D9). */
export function archetypes(cards: DeckCards, byId: ReadonlyMap<SpellId, Spell>): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const [id, n] of cards) {
    const tag = byId.get(id)?.tags[0];
    if (tag !== undefined) counts.set(tag, (counts.get(tag) ?? 0) + n);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Sigillo del mazzo, dall'archetipo più presente (D8): le coppie di colori della tavola. */
export type Sigil = 'frost' | 'gold' | 'doom' | 'arcane';

const SIGIL_BY_TAG: Readonly<Record<string, Sigil>> = { gelo: 'frost', sacro: 'gold', necro: 'doom' };

export function deckSigil(cards: DeckCards, byId: ReadonlyMap<SpellId, Spell>): Sigil {
  const top = archetypes(cards, byId)[0];
  return top === undefined ? 'arcane' : (SIGIL_BY_TAG[top.tag] ?? 'arcane');
}

function sameCards(a: DeckCards, b: DeckCards): boolean {
  if (deckTotal(a) !== deckTotal(b)) return false;
  for (const [id, n] of a) if ((b.get(id) ?? 0) !== n) return false;
  for (const [id, n] of b) if ((a.get(id) ?? 0) !== n) return false;
  return true;
}

/** Modifiche non salvate rispetto al mazzo del server (D10). */
export function isDirty(draft: DeckDraft, saved: Deck): boolean {
  return draft.name.trim() !== saved.name || !sameCards(draft.cards, saved.cards);
}

/** Nome ammesso dal server: 1–24 caratteri dopo il trim (D2). */
export const DECK_NAME_MAX = 24;

export function nameValid(name: string): boolean {
  const length = [...name.trim()].length;
  return length >= 1 && length <= DECK_NAME_MAX;
}

/** Ordine della lista e della card della home: prima l'attivo, poi i modificati più di recente (D12). */
export function byRecency(decks: readonly Deck[]): Deck[] {
  return [...decks].sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt.localeCompare(a.updatedAt));
}
