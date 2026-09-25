import i18next from 'i18next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startMockServer, type MockServerHandle } from '../mock-server/index';
import mockCatalog from '../mock-server/spells.json';
import { normalizeSpellCatalog } from '../src/api/adapter';
import { initI18n } from '../src/i18n';
import { createWebStorage } from '../src/lib/storage';
import { effectPresentation, isKnownEffectKind } from '../src/spells/effects.registry';
import fallbackCatalog from '../src/spells/fallback.json';
import { targetsSupported } from '../src/spells/targets.registry';
import { spellName, spellText, spellTypeLine } from '../src/spells/texts';

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
      expect(targetsSupported(spell), `${spell.id}: bersagli ${spell.targets.map((t) => t.type).join(', ')}`).toBe(true);
      for (const effect of spell.effects) {
        expect(isKnownEffectKind(effect.kind), `${spell.id}: effect ${effect.kind}`).toBe(true);
        const text = effectPresentation(effect.kind).describe(i18next.t, effect.params);
        // Un testo vuoto o con la chiave grezza vuol dire traduzione mancante.
        expect(text.length > 0 && !text.includes('spells.effect'), `${spell.id}: "${text}"`).toBe(true);
      }
    }
    // I parametri finiscono davvero nel testo generato: `duration: 2`.
    expect(effectPresentation('freeze_piece').describe(i18next.t, { duration: 2 })).toContain('2');
  });

  /** Nomi e testi per id (ASSUMPTIONS §7, M4): ogni magia del catalogo ne ha uno in italiano e in inglese. */
  it('ogni magia ha nome, testo e archetipo nell’i18n, in entrambe le lingue', async () => {
    await initI18n(createWebStorage(() => undefined));
    const { spells } = normalizeSpellCatalog(mockCatalog);
    for (const lang of ['it', 'en']) {
      await i18next.changeLanguage(lang);
      for (const spell of spells) {
        const name = spellName(i18next.t, spell, spell.id);
        const text = spellText(i18next.t, spell, spell.id).join(' ');
        const type = spellTypeLine(i18next.t, spell);
        for (const value of [name, text, type]) expect(value.includes('spells.'), `${lang} ${spell.id}: "${value}"`).toBe(false);
        expect(text.length, `${lang} ${spell.id}: testo vuoto`).toBeGreaterThan(0);
      }
    }
    await i18next.changeLanguage('it');
    const frost = spells.find((s) => s.id === 'frost');
    expect([spellName(i18next.t, frost, 'frost'), spellTypeLine(i18next.t, frost)]).toEqual(['Brina', 'Magia · Gelo']);
  });
});
