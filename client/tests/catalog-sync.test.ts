import i18next from 'i18next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startMockServer, type MockServerHandle } from '../mock-server/index';
import mockCatalog from '../mock-server/spells.json';
import { normalizeSpellCatalog } from '../src/api/adapter';
import { initI18n } from '../src/i18n';
import { createWebStorage } from '../src/lib/storage';
import { effectPresentation, isKnownEffectKind } from '../src/spells/effects.registry';
import fallbackCatalog from '../src/spells/fallback.json';
import { targetResolver } from '../src/spells/targets.registry';

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

  /**
   * Copertura dei registry (briefing §5.1.8): quando arriverà una magia nuova, questo test dirà subito cosa manca.
   * Un effetto o un bersaglio sconosciuto non fa crollare la UI, ma qui è un errore: significa che il client è
   * indietro rispetto al server.
   */
  it('ogni effetto e ogni tipo di bersaglio del catalogo hanno una voce nei registry, con un testo di regole', async () => {
    await initI18n(createWebStorage(() => undefined));
    const { spells } = normalizeSpellCatalog(mockCatalog);
    for (const spell of spells) {
      expect(targetResolver(spell.targetType), `${spell.id}: target_type ${spell.targetType}`).not.toBeNull();
      for (const effect of spell.effects) {
        expect(isKnownEffectKind(effect.kind), `${spell.id}: effect ${effect.kind}`).toBe(true);
        const text = effectPresentation(effect.kind).describe(i18next.t, effect.params);
        // Un testo vuoto o con la chiave grezza vuol dire traduzione mancante.
        expect(text.length > 0 && !text.includes('spells.effect'), `${spell.id}: "${text}"`).toBe(true);
      }
    }
    // I parametri del catalogo finiscono davvero nel testo: `turns: 2` di frostbolt.
    const frostbolt = spells.find((s) => s.id === 'frostbolt');
    expect(effectPresentation('freeze_piece').describe(i18next.t, frostbolt?.effects[0]?.params ?? {})).toContain('2');
  });
});
