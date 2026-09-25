import { normalizeSpellCatalog } from '../api/adapter';
import { createLogger } from '../lib/log';
import { createCatalogStore } from '../spells/catalog';
import fallbackCatalog from '../spells/fallback.json';
import type { Spell } from '../spells/schema';

/** Catalogo per i test: quello della riserva, servito senza rete e senza log. */
export function testCatalogStore(spells: readonly Spell[] = normalizeSpellCatalog(fallbackCatalog).spells) {
  return createCatalogStore({
    api: { fetchSpellCatalog: () => Promise.resolve({ ok: true, value: spells }) },
    log: createLogger(() => undefined),
  });
}
