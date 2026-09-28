import { CATALOG, DECK_RECIPE, DECK_SIZE, maxCopies, RAW_CATALOG } from './catalog';

/** Porting di `spells/decks.go`: regole pure dei mazzi personali. */

export const MAX_DECKS = 10;
export const DECK_NAME_MAX = 24;

export type DeckCards = Map<string, number>;

export type DeckProblemCode = 'unknown_spell' | 'too_many_copies' | 'not_owned' | 'deck_size';

export interface DeckProblem {
  readonly code: DeckProblemCode;
  readonly spellId?: string;
}

export function deckSize(cards: DeckCards): number {
  let n = 0;
  for (const c of cards.values()) n += c;
  return n;
}

/** `ValidateDeck`: problemi in ordine di id, poi la dimensione. */
export function validateDeck(cards: DeckCards, owned: ReadonlyMap<string, number>): DeckProblem[] {
  const problems: DeckProblem[] = [];
  for (const id of [...cards.keys()].sort()) {
    const n = cards.get(id) ?? 0;
    if (n <= 0) continue;
    const spell = CATALOG.get(id);
    if (spell === undefined) problems.push({ code: 'unknown_spell', spellId: id });
    else if (n > maxCopies(spell.rarity)) problems.push({ code: 'too_many_copies', spellId: id });
    else if (n > (owned.get(id) ?? 0)) problems.push({ code: 'not_owned', spellId: id });
  }
  if (deckSize(cards) !== DECK_SIZE) problems.push({ code: 'deck_size' });
  return problems;
}

/** `BlockingProblem`: tutti tranne la dimensione impediscono anche la bozza (D3). */
export function blockingProblem(problems: readonly DeckProblem[]): DeckProblem | null {
  return problems.find((p) => p.code !== 'deck_size') ?? null;
}

/** `ValidDeckName`: nome ripulito, 1–24 caratteri. */
export function validDeckName(name: string): string | null {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= DECK_NAME_MAX ? trimmed : null;
}

/** `StarterDeck` (D4). */
export function starterDeck(owned: ReadonlyMap<string, number>): DeckCards {
  const deck: DeckCards = new Map();
  const room = (id: string) => {
    const spell = CATALOG.get(id);
    if (spell === undefined) return 0;
    return Math.min(maxCopies(spell.rarity), owned.get(id) ?? 0) - (deck.get(id) ?? 0);
  };
  let total = 0;
  for (const [id, count] of DECK_RECIPE) {
    const n = Math.min(count, room(id));
    if (n > 0) {
      deck.set(id, (deck.get(id) ?? 0) + n);
      total += n;
    }
  }
  const byCost = [...RAW_CATALOG].sort((a, b) => a.mana_cost - b.mana_cost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const spell of byCost) {
    while (total < DECK_SIZE && room(spell.id) > 0) {
      deck.set(spell.id, (deck.get(spell.id) ?? 0) + 1);
      total++;
    }
  }
  return deck;
}

/** `Expand`: le carte ordinate per id. */
export function expand(cards: DeckCards): string[] {
  return [...cards.keys()].sort().flatMap((id) => Array.from({ length: cards.get(id) ?? 0 }, () => id));
}
