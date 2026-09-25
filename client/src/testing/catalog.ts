import { normalizeSpellCatalog } from '../api/adapter';
import { createLogger } from '../lib/log';
import { createCatalogStore } from '../spells/catalog';
import fallbackCatalog from '../spells/fallback.json';
import type { Spell, TargetSpec } from '../spells/schema';

/** Catalogo per i test: quello della riserva, servito senza rete e senza log. */
export function testCatalogStore(spells: readonly Spell[] = normalizeSpellCatalog(fallbackCatalog).spells) {
  return createCatalogStore({
    api: { fetchSpellCatalog: () => Promise.resolve({ ok: true, value: spells }) },
    log: createLogger(() => undefined),
  });
}

/** Un bersaglio con i filtri vuoti, salvo quelli indicati. */
export function targetSpec(type: string, overrides: Partial<TargetSpec> = {}): TargetSpec {
  return { type, pieces: [], requireEffect: null, emptySquare: false, maxDistance: 0, ownRanks: [], minRank: 0, ...overrides };
}

/** Una magia di prova: un bersaglio pezzo nemico e un effetto di gelo, salvo quanto indicato. */
export function testSpell(overrides: Partial<Spell> = {}): Spell {
  return {
    id: 'x',
    name: 'X',
    manaCost: 1,
    phases: ['main1', 'main2'],
    targets: [targetSpec('enemy_piece')],
    effects: [{ kind: 'freeze_piece', params: { duration: 1 } }],
    tags: [],
    rarity: 'common',
    perTurn: null,
    ...overrides,
  };
}
