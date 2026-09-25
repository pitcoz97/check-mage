import { describe, expect, it, vi } from 'vitest';

import type { ApiResult } from '../api/endpoints';
import { createLogger } from '../lib/log';
import { createCatalogStore } from './catalog';
import fallbackCatalog from './fallback.json';
import type { Spell } from './schema';
import { testSpell } from '../testing/catalog';

/** Catalogo: `GET /spells` è la fonte, `fallback.json` la riserva (G10). Le voci malformate le scarta l'adapter. */

const SPELL: Spell = testSpell({ id: 'nova', name: 'Nova', manaCost: 5 });

function store(result: ApiResult<readonly Spell[]>, warn = vi.fn()) {
  return createCatalogStore({
    api: { fetchSpellCatalog: () => Promise.resolve(result) },
    log: createLogger((level, message) => (level === 'warn' ? warn(message) : undefined)),
  });
}

describe('catalogo delle magie', () => {
  it('carica dal server e indicizza per id', async () => {
    const catalog = store({ ok: true, value: [SPELL] });
    expect(catalog.getState().status).toBe('idle');
    await catalog.getState().load();
    const state = catalog.getState();
    expect(state.status).toBe('ready');
    expect(state.source).toBe('server');
    expect(state.byId.get('nova')).toEqual(SPELL);
  });

  it('server irraggiungibile: usa la riserva e lo segnala', async () => {
    const warn = vi.fn();
    const catalog = store({ ok: false, error: { status: 0, code: 'network_error' } }, warn);
    await catalog.getState().load();
    const state = catalog.getState();
    expect(state.source).toBe('fallback');
    expect(state.spells).toHaveLength(fallbackCatalog.length);
    expect(state.byId.get('blink')?.targets).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });

  it('un solo caricamento anche con più chiamate', async () => {
    const fetchSpellCatalog = vi.fn<() => Promise<ApiResult<readonly Spell[]>>>(() => Promise.resolve({ ok: true, value: [SPELL] }));
    const catalog = createCatalogStore({ api: { fetchSpellCatalog }, log: createLogger(() => undefined) });
    await Promise.all([catalog.getState().load(), catalog.getState().load()]);
    await catalog.getState().load();
    expect(fetchSpellCatalog).toHaveBeenCalledTimes(1);
  });
});
