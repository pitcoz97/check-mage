import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { CatalogState } from './catalog';

/**
 * Rende disponibile il catalogo delle magie. L'istanza si crea in `main.tsx` (o nei test), come per auth e sessione.
 * Chi lo usa chiama `useCatalog`, che ne avvia il caricamento al primo montaggio.
 */

const CatalogContext = createContext<StoreApi<CatalogState> | null>(null);

export function CatalogProvider({ store, children }: { store: StoreApi<CatalogState>; children: ReactNode }) {
  return <CatalogContext.Provider value={store}>{children}</CatalogContext.Provider>;
}

function useCatalogStore(): StoreApi<CatalogState> {
  const store = useContext(CatalogContext);
  if (store === null) throw new Error('CatalogProvider mancante');
  return store;
}

export function useCatalog<T>(selector: (state: CatalogState) => T): T {
  const store = useCatalogStore();
  const load = useStore(store, (state) => state.load);
  useEffect(() => {
    void load();
  }, [load]);
  return useStore(store, selector);
}
