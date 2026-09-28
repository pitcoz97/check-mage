import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '../../design/components/AppIcon';
import { RARITY_FRAME } from '../../spells/texts';
import {
  COST_CHIPS,
  COST_OPEN_END,
  RARITY_FILTERS,
  SORT_KEYS,
  type CollectionFilters,
  type CostChip,
  type RarityFilter,
} from './collectionView';

/**
 * Intestazione e filtri della Collezione. Un solo albero per le due tavole: le aree della griglia si spostano da
 * Android (titolo e contatore, barra, ricerca e "Possedute", rarità, mana, carte mostrate) a desktop (titolo,
 * contatore e ricerca su una riga; rarità, "Solo possedute" e "Ordina"; mana e carte mostrate).
 */

const AREAS =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-2 [grid-template-areas:'title_count''bar_bar''search_owned''rarity_rarity''cost_cost''shown_shown'] " +
  "lg:grid-cols-[auto_180px_minmax(0,1fr)_auto_auto] lg:gap-x-5 lg:gap-y-0 lg:[grid-template-areas:'title_count_._search_search''title_bar_._search_search''rarity_rarity_rarity_owned_sort''cost_cost_cost_cost_shown']";

const CHIP_ON = 'bg-arcane-deep text-primary shadow-ring-arcane';
const CHIP_OFF = 'bg-sunken text-tertiary shadow-ring-elevated';

export function CollectionControls({
  filters,
  owned,
  total,
  shown,
  onChange,
}: {
  filters: CollectionFilters;
  owned: number;
  total: number;
  shown: number;
  onChange(next: Partial<CollectionFilters>): void;
}) {
  const { t } = useTranslation();
  const percent = total === 0 ? 0 : Math.round((owned / total) * 100);

  return (
    <div className={AREAS}>
      <h1 className="self-baseline font-display text-[26px] font-bold [grid-area:title] lg:self-center lg:text-32 lg:tracking-[0.02em]">
        {t('collection.title')}
      </h1>

      <p className="self-baseline text-13 font-bold [grid-area:count] lg:self-end">
        <span className="text-gold-bright">{owned}</span> <span className="text-muted lg:hidden">{t('collection.ofShort', { total })}</span>
        <span className="hidden text-muted lg:inline">{t('collection.of', { total })}</span>
      </p>
      <div
        role="progressbar"
        aria-label={t('collection.progress', { owned, total })}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={owned}
        className="h-[5px] overflow-hidden rounded-pill bg-panel [grid-area:bar] lg:mt-1.5 lg:h-1.5 lg:self-start"
      >
        <div className="h-full rounded-pill bg-gold" style={{ width: `${percent}%` }} />
      </div>

      <label className="flex h-11 min-w-0 items-center gap-2 rounded-10 bg-panel px-3 shadow-ring-elevated [grid-area:search] lg:w-[280px] lg:gap-2.5 lg:self-center lg:justify-self-end lg:px-3.5">
        <AppIcon name="search" strokeWidth={2} className="size-[17px] shrink-0 text-muted lg:size-[18px]" />
        <input
          type="search"
          value={filters.query}
          aria-label={t('collection.search')}
          placeholder={t('collection.search')}
          onChange={(event) => onChange({ query: event.target.value })}
          className="h-10 min-w-0 grow bg-transparent text-15 text-primary outline-none placeholder:text-faint"
        />
      </label>

      <button
        type="button"
        aria-pressed={filters.ownedOnly}
        aria-label={t('collection.ownedOnly')}
        onClick={() => onChange({ ownedOnly: !filters.ownedOnly })}
        className={`flex h-11 items-center gap-[7px] rounded-10 px-3 text-13 font-bold [grid-area:owned] lg:mt-4 lg:h-10 lg:gap-2 lg:px-3.5 lg:text-14 ${filters.ownedOnly ? CHIP_ON : CHIP_OFF}`}
      >
        <span
          className={`flex size-[15px] items-center justify-center rounded-4 lg:size-4 ${
            filters.ownedOnly ? 'bg-gold text-on-gold ring-[1.5px] ring-gold ring-inset' : 'ring-[1.5px] ring-control-off ring-inset'
          }`}
        >
          {filters.ownedOnly && <AppIcon name="check" strokeWidth={3.4} className="size-[11px] lg:size-3" />}
        </span>
        <span className="lg:hidden">{t('collection.ownedShort')}</span>
        <span className="hidden lg:inline">{t('collection.ownedOnly')}</span>
      </button>

      <div role="group" aria-label={t('collection.rarity')} className="flex gap-1.5 [grid-area:rarity] lg:mt-4">
        {RARITY_FILTERS.map((rarity) => (
          <RarityChip key={rarity} rarity={rarity} on={filters.rarity === rarity} onPick={() => onChange({ rarity })} />
        ))}
      </div>

      <label className="mt-4 hidden h-10 items-center gap-2 rounded-10 bg-sunken pr-1.5 pl-3 text-13 font-bold text-muted shadow-ring-elevated [grid-area:sort] lg:flex">
        {t('collection.sort')}
        <select
          value={filters.sort}
          onChange={(event) => onChange({ sort: SORT_KEYS.find((key) => key === event.target.value) ?? 'cost' })}
          className="h-8 cursor-pointer rounded-7 bg-panel px-2 text-14 font-bold text-primary"
        >
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {t(`collection.sortBy.${key}`)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2 [grid-area:cost] lg:mt-4">
        <span aria-hidden="true" className="mr-1 hidden text-12 font-extrabold tracking-[0.1em] text-muted uppercase lg:inline">
          {t('collection.mana')}
        </span>
        <div role="group" aria-label={t('collection.mana')} className="flex grow gap-1 lg:grow-0 lg:gap-2">
          <CostChipButton chip={null} on={filters.cost === null} onPick={() => onChange({ cost: null })} />
          {COST_CHIPS.map((chip) => (
            <CostChipButton key={chip} chip={chip} on={filters.cost === chip} onPick={() => onChange({ cost: chip })} />
          ))}
        </div>
      </div>

      <p className="mt-2 text-12 font-semibold text-muted [grid-area:shown] lg:mt-4 lg:self-center lg:text-13">
        {t(shown === 1 ? 'collection.shownOne' : 'collection.shownMany', { count: shown })}
      </p>
    </div>
  );
}

function RarityChip({ rarity, on, onPick }: { rarity: RarityFilter; on: boolean; onPick(): void }) {
  const { t } = useTranslation();
  return (
    <ChipButton on={on} onPick={onPick} className="grow justify-center gap-1.5 rounded-9 px-2 lg:grow-0 lg:gap-2 lg:rounded-10 lg:px-3.5">
      <span aria-hidden="true" className={`size-2 rotate-45 lg:size-[9px] ${rarity === 'all' ? '' : RARITY_FRAME[rarity].gem}`} />
      {t(`collection.rarityFilter.${rarity}`)}
    </ChipButton>
  );
}

function ChipButton({ on, onPick, className, children }: { on: boolean; onPick(): void; className: string; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onPick} className={`flex h-[38px] items-center text-13 font-bold lg:h-10 lg:text-14 ${on ? CHIP_ON : CHIP_OFF} ${className}`}>
      {children}
    </button>
  );
}

function CostChipButton({ chip, on, onPick }: { chip: CostChip | null; on: boolean; onPick(): void }) {
  const { t } = useTranslation();
  const value = chip === null ? null : chip === COST_OPEN_END ? t('collection.costOpenEnd', { cost: chip }) : String(chip);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={value === null ? t('collection.costAllLabel') : t('collection.costLabel', { cost: value })}
      onClick={onPick}
      className={`h-[38px] min-w-[34px] grow rounded-pill px-1.5 text-14 font-extrabold lg:h-10 lg:min-w-10 lg:grow-0 lg:px-2.5 lg:text-15 ${
        on ? 'bg-gold text-on-gold shadow-edge-gold' : 'bg-sunken text-gold-bright shadow-ring-elevated'
      }`}
    >
      {value ?? t('collection.costAll')}
    </button>
  );
}
