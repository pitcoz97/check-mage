import { useTranslation } from 'react-i18next';

import { AppIcon } from '../../design/components/AppIcon';
import { SpellCardFace } from '../../game/hand/SpellCard';
import { RARITY_FRAME } from '../../spells/texts';
import { COST_CHIPS, COST_OPEN_END, RARITY_FILTERS, type CollectionFilters, type CollectionItem } from '../Collection/collectionView';
import { copyCap, poolState, type DeckCards } from './deckEditor';

/**
 * «Le tue carte» dell'editor: filtri e griglia delle carte del catalogo con le copie possedute. Un tocco aggiunge
 * una copia; il badge dice perché non si può (non posseduta, massimo, mazzo pieno), «×n» quante sono nel mazzo.
 */

const CHIP_ON = 'bg-arcane-deep text-primary shadow-ring-arcane';
const CHIP_OFF = 'bg-sunken text-tertiary shadow-ring-elevated';

export function PoolFilters({
  filters,
  compact,
  onChange,
}: {
  filters: CollectionFilters;
  /** Android: solo i chip di rarità, come nella tavola. */
  compact: boolean;
  onChange(next: Partial<CollectionFilters>): void;
}) {
  const { t } = useTranslation();
  const rarity = (
    <div role="group" aria-label={t('collection.rarity')} className="flex gap-1.5">
      {RARITY_FILTERS.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={filters.rarity === r}
          onClick={() => onChange({ rarity: r })}
          className={`flex items-center font-bold ${
            compact ? 'h-9 grow justify-center gap-1.5 rounded-9 px-1.5 text-[12.5px]' : 'h-10 gap-[7px] rounded-10 px-3 text-13'
          } ${filters.rarity === r ? CHIP_ON : CHIP_OFF}`}
        >
          <span aria-hidden="true" className={`rotate-45 ${compact ? 'size-[7px]' : 'size-2'} ${r === 'all' ? '' : RARITY_FRAME[r].gem}`} />
          {t(`collection.rarityFilter.${r}`)}
        </button>
      ))}
    </div>
  );
  if (compact) return rarity;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-10 w-[230px] items-center gap-2 rounded-10 bg-panel px-3 shadow-ring-elevated">
          <AppIcon name="search" strokeWidth={2} className="size-4 shrink-0 text-muted" />
          <input
            type="search"
            value={filters.query}
            aria-label={t('collection.search')}
            placeholder={t('collection.search')}
            onChange={(event) => onChange({ query: event.target.value })}
            className="h-9 min-w-0 grow bg-transparent text-14 text-primary outline-none placeholder:text-faint"
          />
        </label>
        {rarity}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden="true" className="mr-1 text-12 font-extrabold tracking-[0.1em] text-muted uppercase">
          {t('collection.mana')}
        </span>
        <div role="group" aria-label={t('collection.mana')} className="flex flex-wrap gap-1.5">
          {[null, ...COST_CHIPS].map((chip) => {
            const on = filters.cost === chip;
            const value = chip === null ? null : chip === COST_OPEN_END ? t('collection.costOpenEnd', { cost: chip }) : String(chip);
            return (
              <button
                key={chip ?? 'all'}
                type="button"
                aria-pressed={on}
                aria-label={value === null ? t('collection.costAllLabel') : t('collection.costLabel', { cost: value })}
                onClick={() => onChange({ cost: chip })}
                className={`h-9 min-w-[38px] rounded-pill px-2.5 text-14 font-extrabold ${
                  on ? 'bg-gold text-on-gold shadow-edge-gold' : 'bg-sunken text-gold-bright shadow-ring-elevated'
                }`}
              >
                {value ?? t('collection.costAll')}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PoolGrid({
  items,
  cards,
  deckSize,
  compact,
  onAdd,
}: {
  items: readonly CollectionItem[];
  cards: DeckCards;
  deckSize: number;
  compact: boolean;
  onAdd(item: CollectionItem): void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return <p className="flex h-[200px] items-center justify-center text-15 text-muted">{t('collection.empty')}</p>;
  return (
    <ul
      className={
        compact
          ? 'grid grid-cols-3 gap-x-2 gap-y-3.5 pt-1.5'
          : 'grid grid-cols-[repeat(auto-fill,minmax(134px,1fr))] gap-x-2.5 gap-y-5'
      }
    >
      {items.map((item) => (
        <PoolTile key={item.spell.id} item={item} cards={cards} deckSize={deckSize} compact={compact} onAdd={() => onAdd(item)} />
      ))}
    </ul>
  );
}

function PoolTile({
  item,
  cards,
  deckSize,
  compact,
  onAdd,
}: {
  item: CollectionItem;
  cards: DeckCards;
  deckSize: number;
  compact: boolean;
  onAdd(): void;
}) {
  const { t } = useTranslation();
  const state = poolState(item, cards, deckSize);
  const inDeck = cards.get(item.spell.id) ?? 0;
  const faded = state === 'locked' ? 'opacity-35 grayscale-[0.8]' : state === 'available' ? '' : 'opacity-55';
  const label = t('decks.addLabel', { name: item.name, cost: item.spell.manaCost, inDeck, owned: item.copies });
  return (
    <li className="flex flex-col items-center gap-[7px]">
      <button
        type="button"
        data-card={item.spell.id}
        data-state={state}
        aria-label={label}
        aria-disabled={state !== 'available'}
        onClick={onAdd}
        className={`relative p-0 ${compact ? 'h-[154px] w-[110px] rounded-7' : 'h-[188px] w-[134px] rounded-9'}`}
      >
        <span className={`pointer-events-none absolute top-0 left-0 origin-top-left ${compact ? 'scale-[0.55]' : 'scale-[0.67]'} ${faded}`}>
          <SpellCardFace spell={item.spell} spellId={item.spell.id} />
        </span>
        {state !== 'available' && (
          <span
            className={`absolute left-1/2 flex h-6 -translate-x-1/2 items-center rounded-pill bg-nav/92 px-[9px] text-11 font-bold whitespace-nowrap text-card-type shadow-ring-elevated ${
              compact ? 'top-[58px]' : 'top-[72px]'
            }`}
          >
            {t(`decks.badge.${state}`)}
          </span>
        )}
        {inDeck > 0 && (
          <span
            data-in-deck={inDeck}
            className="absolute -top-1.5 -right-1.5 flex h-[26px] min-w-[26px] items-center justify-center rounded-pill bg-arcane px-1.5 text-12 font-extrabold text-card-frame ring-2 ring-app"
          >
            {t('decks.inDeck', { count: inDeck })}
          </span>
        )}
      </button>
      <span aria-hidden="true" className="flex gap-1.5">
        {Array.from({ length: item.maxCopies }, (_, i) => (
          <span
            key={i}
            className={`size-[9px] rotate-45 rounded-2 ${
              i < inDeck
                ? 'bg-gold shadow-glow-mana-sm'
                : i < copyCap(item)
                  ? 'ring-[1.5px] ring-gold/75 ring-inset'
                  : 'ring-[1.5px] ring-pip-empty ring-inset'
            }`}
          />
        ))}
      </span>
    </li>
  );
}
