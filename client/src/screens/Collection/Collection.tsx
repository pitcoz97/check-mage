import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { Spinner } from '../../design/components/Spinner';
import { CardDetailPanel, CardDetailSheet } from './CardDetail';
import { CollectionControls } from './CollectionControls';
import { CollectionGrid } from './CollectionGrid';
import { DEFAULT_FILTERS, visibleItems, type CollectionFilters, type CollectionItem } from './collectionView';
import { useCollection } from './useCollection';

/**
 * Collezione (tavole "Collezione · desktop" e "Collezione · Android"): le magie del catalogo con le copie possedute
 * (`GET /me/collection`), filtri, ricerca e dettaglio. Su desktop il dettaglio è il pannello a destra, sempre
 * aperto sulla carta scelta (all'inizio la prima); su Android è un foglio che si apre toccando una carta.
 */
export function Collection() {
  const { t } = useTranslation();
  const { state, retry } = useCollection();

  if (state.kind === 'loading') return <Spinner label={t('collection.loading')} />;
  if (state.kind === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="font-display text-[26px] font-bold lg:text-32">{t('collection.title')}</h1>
        <p role="alert">{t('collection.error')}</p>
        <Button variant="secondary" size="sm" onClick={retry}>
          {t('collection.retry')}
        </Button>
      </div>
    );
  }
  return <CollectionView items={state.items} owned={state.owned} total={state.total} />;
}

function CollectionView({ items, owned, total }: { items: readonly CollectionItem[]; owned: number; total: number }) {
  const { i18n } = useTranslation();
  const [filters, setFilters] = useState<CollectionFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const shown = useMemo(() => visibleItems(items, filters, i18n.language), [items, filters, i18n.language]);
  const selected = items.find((item) => item.spell.id === selectedId) ?? shown[0] ?? items[0];
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  return (
    // Su desktop il pannello arriva a 20px dal bordo, come nella tavola: cinque colonne da 156px anche a 1440.
    <div className="flex flex-col gap-4 lg:-mr-5 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <section className="flex min-w-0 flex-col gap-4">
        <CollectionControls
          filters={filters}
          owned={owned}
          total={total}
          shown={shown.length}
          onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
        />
        <div className="lg:pt-2.5">
          <CollectionGrid
            items={shown}
            selectedId={selected?.spell.id ?? null}
            onPick={(id) => {
              setSelectedId(id);
              setSheetOpen(true);
            }}
          />
        </div>
      </section>
      {selected !== undefined && (
        <div className="hidden lg:sticky lg:top-8 lg:block">
          <CardDetailPanel item={selected} />
        </div>
      )}
      {sheetOpen && selected !== undefined && <CardDetailSheet item={selected} onClose={closeSheet} />}
    </div>
  );
}
