import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startMockServer, type MockServerHandle } from '../mock-server/index';
import mockCatalog from '../mock-server/spells.json';
import { normalizeSpellCatalog } from '../src/api/adapter';
import fallbackCatalog from '../src/spells/fallback.json';

let server: MockServerHandle;
beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true });
});
afterAll(async () => {
  await server.close();
});

const byId = <T extends { id: string }>(list: readonly T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));

describe('catalogo magie', () => {
  it('src/spells/fallback.json e mock-server/spells.json sono identici', () => {
    expect(fallbackCatalog).toEqual(mockCatalog);
  });

  it('GET /spells del mock serve lo stesso catalogo della riserva, a meno dell’ordine', async () => {
    const body = (await (await fetch(`${server.httpUrl}/spells`)).json()) as { data: { id: string }[] };
    expect(byId(body.data)).toEqual(byId(fallbackCatalog));
  });

  it('il catalogo del mock passa per intero dallo schema del client', () => {
    const { spells, warnings } = normalizeSpellCatalog(mockCatalog);
    expect(warnings).toEqual([]);
    expect(spells).toHaveLength(mockCatalog.length);
  });
});
