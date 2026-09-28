import { useTranslation } from 'react-i18next';

import { AppIcon } from '../../design/components/AppIcon';
import type { SpellId } from '../../game/model';
import type { Spell } from '../../spells/schema';
import { RARITY_FRAME, spellTypeLine, tagLabel } from '../../spells/texts';
import type { CollectionItem } from '../Collection/collectionView';
import { archetypes, CURVE_BUCKETS, deckTotal, manaCurve, type DeckCards } from './deckEditor';

/**
 * I pezzi del pannello del mazzo, comuni alle due tavole: stato (contatore, pillola, barra), curva di mana, archetipi
 * e righe del mazzo con − e +.
 */

type Variant = 'desktop' | 'mobile';

/** Pillola dello stato: «Mazzo valido» verde o «Mancano n carte» viola. */
export function DeckStatusPill({ cards, deckSize }: { cards: DeckCards; deckSize: number }) {
  const { t } = useTranslation();
  const total = deckTotal(cards);
  const valid = total === deckSize;
  const missing = deckSize - total;
  return (
    <span
      role="status"
      data-deck-valid={valid}
      className={`flex h-[26px] shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-12 font-extrabold whitespace-nowrap lg:h-7 ${
        valid ? 'bg-play-bright/14 text-valid-ink' : 'bg-arcane/14 text-arcane-bright'
      }`}
    >
      {valid && <AppIcon name="check" strokeWidth={3} className="size-[13px]" />}
      {valid ? t('decks.valid') : t(missing === 1 ? 'decks.missingOne' : 'decks.missingMany', { count: missing })}
    </span>
  );
}

export function DeckProgress({ cards, deckSize }: { cards: DeckCards; deckSize: number }) {
  const total = deckTotal(cards);
  const valid = total === deckSize;
  return (
    <div aria-hidden="true" className="h-1.5 grow overflow-hidden rounded-pill bg-sunken">
      <div
        className={`h-full rounded-pill transition-[width] duration-200 ${valid ? 'bg-play-bright' : 'bg-gold'}`}
        style={{ width: `${Math.min(100, Math.round((total / deckSize) * 100))}%` }}
      />
    </div>
  );
}

export function ManaCurve({ cards, byId, variant }: { cards: DeckCards; byId: ReadonlyMap<SpellId, Spell>; variant: Variant }) {
  const { t } = useTranslation();
  const { buckets, average } = manaCurve(cards, byId);
  const max = Math.max(1, ...buckets);
  const barMax = variant === 'desktop' ? 56 : 40;
  const label = (i: number) => (i === CURVE_BUCKETS - 1 ? t('collection.costOpenEnd', { cost: i }) : String(i));
  const width = variant === 'desktop' ? 'w-[30px]' : 'w-7';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline">
        <h3 className="grow text-12 font-extrabold tracking-[0.1em] text-muted uppercase">{t('decks.curve')}</h3>
        <span className="text-13 text-muted">
          {t('decks.avg')} <strong className="text-primary">{average === null ? t('decks.avgNone') : average.toFixed(1)}</strong>
        </span>
      </div>
      <div
        role="img"
        aria-label={t('decks.curveLabel', { bars: buckets.map((n, i) => t('decks.curveBar', { cost: label(i), count: n })).join(', ') })}
        className="flex items-end justify-between border-b border-curve-axis px-1.5"
      >
        {buckets.map((n, i) => (
          <div key={i} data-curve={label(i)} className={`flex flex-col items-center justify-end gap-[3px] ${width} ${variant === 'desktop' ? 'h-[74px]' : 'h-[58px]'}`}>
            <span className="h-3.5 text-11 leading-[14px] font-bold text-card-type">{n > 0 ? n : ''}</span>
            <div className="w-full rounded-t-4 bg-gold" style={{ height: n > 0 ? `${Math.max(6, Math.round((n / max) * barMax))}px` : '0px' }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex justify-between px-1.5">
        {buckets.map((_, i) => (
          <span key={i} className={`text-center text-11 font-bold text-muted ${width}`}>
            {label(i)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ArchetypeChips({ cards, byId }: { cards: DeckCards; byId: ReadonlyMap<SpellId, Spell> }) {
  const { t } = useTranslation();
  const list = archetypes(cards, byId);
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {list.map(({ tag, count }) => (
        <li key={tag} className="flex h-[26px] items-center gap-1.5 rounded-7 bg-sunken px-[9px] text-12 font-bold text-tertiary shadow-ring-elevated">
          {tagLabel(t, tag)} <strong className="text-primary">{count}</strong>
        </li>
      ))}
    </ul>
  );
}

export function DeckRows({
  rows,
  cards,
  deckSize,
  variant,
  onAdd,
  onRemove,
}: {
  rows: readonly { item: CollectionItem; count: number }[];
  cards: DeckCards;
  deckSize: number;
  variant: Variant;
  onAdd(item: CollectionItem): void;
  onRemove(item: CollectionItem): void;
}) {
  const { t } = useTranslation();
  const full = deckTotal(cards) >= deckSize;
  if (rows.length === 0) {
    return <p className="rounded-10 border border-dashed border-pip-empty px-3 py-[18px] text-center text-13 leading-[1.45] text-muted">{t('decks.emptyDeck')}</p>;
  }
  const button = variant === 'desktop' ? 'size-[30px]' : 'size-10';
  return (
    <ul className={`flex flex-col ${variant === 'desktop' ? 'gap-[5px]' : 'gap-1.5'}`}>
      {rows.map(({ item, count }) => {
        const plusOff = full || count >= Math.min(item.maxCopies, item.copies);
        return (
          <li
            key={item.spell.id}
            data-row={item.spell.id}
            className={`flex items-center gap-2.5 rounded-8 bg-sunken pr-1 pl-2 ${variant === 'desktop' ? 'h-[42px]' : 'h-[50px]'}`}
          >
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-gold text-12 font-extrabold text-on-gold shadow-edge-coin">
              {item.spell.manaCost}
            </span>
            <span aria-hidden="true" className={`size-2 shrink-0 rotate-45 ${RARITY_FRAME[item.spell.rarity].gem}`} />
            <span className="flex min-w-0 grow flex-col">
              <span className="truncate text-14 font-bold">{item.name}</span>
              <span className="text-11 font-semibold text-faint">{spellTypeLine(t, item.spell)}</span>
            </span>
            <span className="w-[26px] text-right text-14 font-extrabold text-gold-bright">{t('decks.inDeck', { count })}</span>
            <button
              type="button"
              aria-label={t('decks.minus', { name: item.name })}
              onClick={() => onRemove(item)}
              className={`flex items-center justify-center rounded-7 bg-quiet text-primary ${button}`}
            >
              <AppIcon name="minus" strokeWidth={2.6} className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('decks.plus', { name: item.name })}
              disabled={plusOff}
              onClick={() => onAdd(item)}
              className={`flex items-center justify-center rounded-7 bg-quiet text-primary disabled:opacity-35 ${button}`}
            >
              <AppIcon name="plus" strokeWidth={2.6} className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
