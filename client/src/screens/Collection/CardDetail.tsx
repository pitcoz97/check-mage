import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '../../design/components/AppIcon';
import { SpellCardFace } from '../../game/hand/SpellCard';
import { PHASES, type Phase } from '../../game/model';
import { RARITY_FRAME, spellTypeLine } from '../../spells/texts';
import { CopyPips } from './CollectionGrid';
import type { CollectionItem } from './collectionView';

/**
 * Dettaglio della carta: pannello a destra su desktop, foglio dal basso su Android. Mazzi e "Aggiungi a un mazzo"
 * della tavola non ci sono (i mazzi personali non esistono): al loro posto le fasi in cui si lancia. Per una carta
 * non posseduta, solo che non la si ha ancora (C8).
 */

function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}

function PhaseChips({ item, size }: { item: CollectionItem; size: 'panel' | 'sheet' }) {
  const { t } = useTranslation();
  const chip = size === 'panel' ? 'h-[30px] gap-1.5 rounded-8 px-2.5 text-13' : 'h-7 gap-1.5 rounded-7 px-2 text-12';
  return (
    <ul className="flex flex-wrap gap-1.5">
      {item.spell.phases.map((phase) => (
        <li key={phase} className={`flex items-center bg-sunken font-bold shadow-ring-elevated ${chip}`}>
          <span aria-hidden="true" className="size-2 rounded-2 bg-arcane" />
          {t(`match.phase.${isPhase(phase) ? phase : 'unknown'}`)}
        </li>
      ))}
    </ul>
  );
}

function LockedNote() {
  const { t } = useTranslation();
  return (
    <p data-locked-note className="rounded-10 bg-arcane/12 px-3.5 py-3 text-13 leading-[1.4] text-card-type ring-1 ring-arcane/45 ring-inset">
      {t('collection.lockedNote')}
    </p>
  );
}

/** Pannello di dettaglio della tavola desktop (300px). */
export function CardDetailPanel({ item }: { item: CollectionItem }) {
  const { t } = useTranslation();
  const locked = item.copies === 0;
  return (
    <aside aria-label={t('collection.detail')} className="flex min-h-[calc(100dvh-4rem)] flex-col gap-3.5 rounded-16 bg-panel p-5">
      <div className="h-[364px] w-[260px] shrink-0">
        <span className={`block w-[200px] origin-top-left scale-[1.3] ${locked ? 'opacity-50 grayscale-[0.8]' : ''}`}>
          <SpellCardFace spell={item.spell} spellId={item.spell.id} />
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-22 font-bold">{item.name}</h2>
        <p className="flex items-center gap-2 text-13 font-semibold text-muted">
          <span aria-hidden="true" className={`size-[9px] rotate-45 ${RARITY_FRAME[item.spell.rarity].gem}`} />
          {t(`spells.rarity.${item.spell.rarity}`)} · {spellTypeLine(t, item.spell)}
        </p>
      </div>
      <div className="flex items-center gap-2.5 rounded-10 bg-sunken px-3 py-2.5">
        <span className="grow text-13 font-bold text-muted">{t('collection.owned')}</span>
        <CopyPips copies={item.copies} max={item.maxCopies} size="panel" />
        <span className="ml-1 text-15 font-extrabold">{t('collection.ownedCount', { copies: item.copies, max: item.maxCopies })}</span>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-12 font-extrabold tracking-[0.1em] text-muted uppercase">{t('collection.phases')}</h3>
        <PhaseChips item={item} size="panel" />
      </div>
      {locked && <LockedNote />}
    </aside>
  );
}

/** Foglio dal basso della tavola Android: dialog modale; Esc, "Chiudi" e il tocco fuori lo chiudono. */
export function CardDetailSheet({ item, onClose }: { item: CollectionItem; onClose(): void }) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const locked = item.copies === 0;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-app/70 lg:hidden" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('collection.detail')}
        className="flex w-full flex-col gap-4 rounded-t-[20px] bg-panel px-4 pt-2.5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] shadow-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden="true" className="flex justify-center">
          <span className="h-1 w-10 rounded-pill bg-pip-empty" />
        </div>
        <div className="flex gap-4">
          <div className="h-[224px] w-[160px] shrink-0">
            <span className={`block w-[200px] origin-top-left scale-[0.8] ${locked ? 'opacity-50 grayscale-[0.8]' : ''}`}>
              <SpellCardFace spell={item.spell} spellId={item.spell.id} />
            </span>
          </div>
          <div className="flex min-w-0 grow flex-col gap-2.5">
            <div className="flex items-start gap-2">
              <h2 className="grow font-display text-[19px] leading-[1.2] font-bold">{item.name}</h2>
              <button
                ref={closeRef}
                type="button"
                aria-label={t('collection.close')}
                onClick={onClose}
                className="-mt-1 -mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-8 bg-sunken text-tertiary"
              >
                <AppIcon name="close" strokeWidth={2.2} className="size-[18px]" />
              </button>
            </div>
            <p className="flex items-center gap-[7px] text-12 font-semibold text-muted">
              <span aria-hidden="true" className={`size-2 rotate-45 ${RARITY_FRAME[item.spell.rarity].gem}`} />
              {t(`spells.rarity.${item.spell.rarity}`)}
            </p>
            <p className="flex items-center gap-1.5 text-13 font-bold">
              <span className="mr-1 text-muted">{t('collection.owned')}</span>
              <CopyPips copies={item.copies} max={item.maxCopies} size="sheet" />
              <span className="ml-1">{t('collection.ownedCount', { copies: item.copies, max: item.maxCopies })}</span>
            </p>
            <h3 className="text-11 font-extrabold tracking-[0.1em] text-muted uppercase">{t('collection.phases')}</h3>
            <PhaseChips item={item} size="sheet" />
          </div>
        </div>
        {locked && <LockedNote />}
      </section>
    </div>
  );
}
