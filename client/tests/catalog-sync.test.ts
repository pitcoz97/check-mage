import { describe, expect, it } from 'vitest';

import mockCatalog from '../mock-server/spells.json';
import { normalizeSpellCatalog } from '../src/api/adapter';
import fallbackCatalog from '../src/spells/fallback.json';

describe('catalogo magie', () => {
  it('src/spells/fallback.json e mock-server/spells.json sono identici', () => {
    expect(fallbackCatalog).toEqual(mockCatalog);
  });

  it('il catalogo del mock passa per intero dallo schema del client', () => {
    const { spells, warnings } = normalizeSpellCatalog(mockCatalog);
    expect(warnings).toEqual([]);
    expect(spells).toHaveLength(mockCatalog.length);
  });
});
