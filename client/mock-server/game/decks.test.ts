import { describe, expect, it } from 'vitest';

import { RAW_CATALOG } from './catalog';
import { blockingProblem, deckSize, expand, starterDeck, validateDeck, validDeckName } from './decks';
import { starterSet } from '../store/collection';

const owned = starterSet(RAW_CATALOG);

describe('mazzi (spells/decks.go)', () => {
  it('mazzo iniziale: 40 carte valide, deterministico, corto con poche carte', () => {
    const deck = starterDeck(owned);
    expect(deckSize(deck)).toBe(40);
    expect(validateDeck(deck, owned)).toEqual([]);
    expect([...starterDeck(owned)]).toEqual([...deck]);
    expect(deckSize(starterDeck(new Map([['frost', 2], ['shield', 2]])))).toBe(4);
  });

  it('problemi in ordine di id, poi la dimensione; la bozza corta non blocca', () => {
    const bad = new Map([['frost', 3], ['haste', 1], ['nope', 1], ['shatter', 2]]);
    expect(validateDeck(bad, owned)).toEqual([
      { code: 'too_many_copies', spellId: 'frost' },
      { code: 'not_owned', spellId: 'haste' },
      { code: 'unknown_spell', spellId: 'nope' },
      { code: 'not_owned', spellId: 'shatter' },
      { code: 'deck_size' },
    ]);
    expect(blockingProblem(validateDeck(new Map([['frost', 2]]), owned))).toBeNull();
  });

  it('expand e nome', () => {
    expect(expand(new Map([['shield', 1], ['frost', 2]]))).toEqual(['frost', 'frost', 'shield']);
    expect(validDeckName("  Rune d'Oro  ")).toBe("Rune d'Oro");
    expect(validDeckName('   ')).toBeNull();
    expect(validDeckName('x'.repeat(25))).toBeNull();
  });
});
