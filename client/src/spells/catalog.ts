import { createStore, type StoreApi } from 'zustand/vanilla';

import { normalizeSpellCatalog } from '../api/adapter';
import type { Api } from '../api/endpoints';
import type { SpellId } from '../game/model';
import { log as defaultLog, type Logger } from '../lib/log';
import fallbackCatalog from './fallback.json';
import type { Spell } from './schema';

/**
 * Catalogo delle magie: unica fonte di costi, fasi, bersagli ed effetti (briefing §5.1.1).
 *
 * Si carica da `GET /spells`; se la richiesta fallisce si usa `fallback.json`, che è una copia statica e resta una
 * riserva temporanea (G10). La normalizzazione vive nell'adapter: qui si sceglie solo la sorgente e si indicizza.
 */

export type CatalogSource = 'server' | 'fallback';
export type CatalogStatus = 'idle' | 'loading' | 'ready';

export interface CatalogState {
  readonly status: CatalogStatus;
  readonly spells: readonly Spell[];
  readonly byId: ReadonlyMap<SpellId, Spell>;
  /** `null` finché il catalogo non è stato caricato. */
  readonly source: CatalogSource | null;
  /** Carica una volta sola: chiamate successive restituiscono lo stesso caricamento. */
  load(): Promise<void>;
}

export interface CatalogDeps {
  readonly api: Pick<Api, 'fetchSpellCatalog'>;
  readonly log?: Logger;
}

export function createCatalogStore(deps: CatalogDeps): StoreApi<CatalogState> {
  const logger = deps.log ?? defaultLog;
  let loading: Promise<void> | null = null;

  return createStore<CatalogState>()((set) => ({
    status: 'idle',
    spells: [],
    byId: new Map(),
    source: null,

    load() {
      if (loading !== null) return loading;
      set({ status: 'loading' });
      loading = (async () => {
        const result = await deps.api.fetchSpellCatalog();
        const source: CatalogSource = result.ok ? 'server' : 'fallback';
        let spells: readonly Spell[];
        if (result.ok) spells = result.value;
        else {
          logger.warn(`catalogo da fallback.json (${result.error.code})`, result.error);
          // Anche la riserva passa dall'adapter: una voce malformata viene scartata, non fa crollare il catalogo.
          const normalized = normalizeSpellCatalog(fallbackCatalog);
          for (const warning of normalized.warnings) logger.warn(`adapter [${warning.assumption}] ${warning.code}`, warning.detail);
          spells = normalized.spells;
        }
        logger.debug(`catalogo: ${spells.length} magie da ${source}`);
        set({ status: 'ready', spells, byId: new Map(spells.map((spell) => [spell.id, spell])), source });
      })();
      return loading;
    },
  }));
}
