import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CardCollection } from '../../api/types';
import { useCatalog } from '../../spells/CatalogProvider';
import { useApi } from '../../store/AuthProvider';
import { collectionItems, type CollectionItem } from './collectionView';

export type CollectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly items: readonly CollectionItem[]; readonly owned: number; readonly total: number };

/** Collezione da `GET /me/collection`, unita al catalogo per nome, testo, costo e rarità di ogni carta. */
export function useCollection(): { state: CollectionState; retry(): void } {
  const { t } = useTranslation();
  const api = useApi();
  const byId = useCatalog((s) => s.byId);
  const catalogReady = useCatalog((s) => s.status === 'ready');
  const [collection, setCollection] = useState<CardCollection | 'loading' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    const result = await api.fetchCollection();
    return result.ok ? result.value : 'error';
  }, [api]);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setCollection(next);
    });
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const state = useMemo<CollectionState>(() => {
    if (collection === 'error') return { kind: 'error' };
    if (collection === 'loading' || !catalogReady) return { kind: 'loading' };
    return { kind: 'ready', items: collectionItems(t, collection, byId), owned: collection.owned, total: collection.total };
  }, [collection, catalogReady, byId, t]);

  return {
    state,
    retry: () => {
      setCollection('loading');
      setAttempt(attempt + 1);
    },
  };
}
