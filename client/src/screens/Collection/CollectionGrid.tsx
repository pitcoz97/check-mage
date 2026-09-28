import { useTranslation } from 'react-i18next';

import { AppIcon } from '../../design/components/AppIcon';
import { SpellCardFace } from '../../game/hand/SpellCard';
import type { CollectionItem } from './collectionView';

/**
 * Griglia della Collezione (tavole "Collezione · desktop/Android"): la carta del catalogo scalata (0.55 su Android,
 * 0.78 su desktop), i rombi delle copie sotto. Una carta non posseduta è sbiadita, in grigio, col lucchetto.
 */

/** Rombi delle copie: tanti quanti il massimo della rarità (C7), accesi quelli posseduti. */
export function CopyPips({ copies, max, size }: { copies: number; max: number; size: 'grid' | 'sheet' | 'panel' }) {
  const box = { grid: 'size-2 lg:size-2.5', sheet: 'size-[9px]', panel: 'size-[11px]' }[size];
  return (
    <span aria-hidden="true" data-pips={`${copies}/${max}`} className={`flex ${size === 'grid' ? 'gap-[5px] lg:gap-1.5' : 'gap-1.5'}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`${box} rotate-45 rounded-2 ${i < copies ? 'bg-gold shadow-glow-mana-sm' : 'ring-[1.5px] ring-pip-empty ring-inset'}`}
        />
      ))}
    </span>
  );
}

export function CollectionGrid({
  items,
  selectedId,
  onPick,
}: {
  items: readonly CollectionItem[];
  selectedId: string | null;
  onPick(id: string): void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center text-14 text-muted lg:h-[240px] lg:text-15">
        <AppIcon name="decks" strokeWidth={1.6} className="hidden size-9 text-control-off lg:block" />
        {t('collection.empty')}
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-3 gap-x-2 gap-y-4 lg:grid-cols-[repeat(auto-fill,minmax(156px,1fr))] lg:gap-x-2.5 lg:gap-y-[22px]">
      {items.map((item) => (
        <li key={item.spell.id} className="flex flex-col items-center gap-1.5 lg:gap-2">
          <CollectionTile item={item} selected={item.spell.id === selectedId} onPick={() => onPick(item.spell.id)} />
          <CopyPips copies={item.copies} max={item.maxCopies} size="grid" />
        </li>
      ))}
    </ul>
  );
}

function CollectionTile({ item, selected, onPick }: { item: CollectionItem; selected: boolean; onPick(): void }) {
  const { t } = useTranslation();
  const locked = item.copies === 0;
  const label = t('collection.cardLabel', {
    name: item.name,
    cost: item.spell.manaCost,
    owned: locked ? t('collection.notOwned') : t(item.copies === 1 ? 'collection.copiesOne' : 'collection.copiesMany', { count: item.copies }),
  });
  return (
    <button
      type="button"
      data-card={item.spell.id}
      data-locked={locked}
      aria-label={label}
      aria-pressed={selected}
      onClick={onPick}
      className={`relative h-[154px] w-[110px] rounded-7 p-0 transition-transform duration-150 lg:h-[218px] lg:w-[156px] lg:rounded-10 ${
        selected ? 'lg:-translate-y-1.5 lg:shadow-glow-selected' : ''
      }`}
    >
      <span className={`pointer-events-none absolute top-0 left-0 origin-top-left scale-[0.55] lg:scale-[0.78] ${locked ? 'opacity-40 grayscale-[0.8]' : ''}`}>
        <SpellCardFace spell={item.spell} spellId={item.spell.id} />
      </span>
      {locked && (
        <span className="absolute top-[58px] left-1/2 flex size-[30px] -translate-x-1/2 items-center justify-center gap-1.5 rounded-full bg-nav/92 text-12 font-bold whitespace-nowrap text-card-type shadow-ring-elevated lg:top-[84px] lg:h-7 lg:w-auto lg:rounded-pill lg:px-2.5">
          <AppIcon name="lock" strokeWidth={2.2} className="size-3.5 lg:size-[13px]" />
          <span className="hidden lg:inline">{t('collection.notOwned')}</span>
        </span>
      )}
    </button>
  );
}
