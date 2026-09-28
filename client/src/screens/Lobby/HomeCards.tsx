import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AppIcon, type AppIconName } from '../../design/components/AppIcon';
import { Spinner } from '../../design/components/Spinner';
import { RARITIES } from '../../spells/schema';
import { RARITY_FRAME } from '../../spells/texts';
import { useAuth } from '../../store/AuthProvider';
import { ownedByRarity } from '../Collection/collectionView';
import { useCollection } from '../Collection/useCollection';
import { RankingRows } from '../Leaderboard/RankingRows';
import { useLeaderboard } from '../Leaderboard/useLeaderboard';

/**
 * La riga di card in fondo alla home desktop (tavola "Home · desktop"). Mazzi e Amici non hanno dati sul server: la card
 * c'è, con «Presto» e nessun dato finto (D9). Classifica (D11) e Collezione (C9–C11) sono vere.
 */

function CardTitle({ icon, title, trailing, to }: { icon: AppIconName; title: string; trailing?: ReactNode; to?: string }) {
  const content = (
    <>
      <span className="flex size-8 items-center justify-center rounded-8 bg-elevated text-gold">
        <AppIcon name={icon} className="size-[18px]" />
      </span>
      <h3 className="grow font-display text-18 font-bold">{title}</h3>
      {trailing}
    </>
  );
  // Con `to` la riga del titolo è un link, col chevron della tavola.
  if (to === undefined) return <div className="flex items-center gap-2.5">{content}</div>;
  return (
    <Link to={to} className="flex items-center gap-2.5 text-primary">
      {content}
      <AppIcon name="chevron" strokeWidth={2.2} className="size-4 text-muted" />
    </Link>
  );
}

export function SoonCard({ icon, title }: { icon: AppIconName; title: string }) {
  const { t } = useTranslation();
  return (
    <section data-soon-card aria-disabled="true" className="flex flex-col gap-2 rounded-16 bg-panel p-[18px]">
      <CardTitle icon={icon} title={title} trailing={<span className="rounded-pill bg-quiet px-2 py-0.5 text-11 font-bold text-muted">{t('nav.soon')}</span>} />
      <p className="text-14 text-muted">{t('home.soonText')}</p>
    </section>
  );
}

/** Collezione in breve: copie possedute su quelle possibili e per rarità (`GET /me/collection`). */
export function CollectionCard() {
  const { t } = useTranslation();
  const { state } = useCollection();
  const byRarity = state.kind === 'ready' ? ownedByRarity(state.items) : null;

  return (
    <section data-collection-card className="flex flex-col gap-2 rounded-16 bg-panel p-[18px]">
      <CardTitle icon="collection" title={t('nav.collection')} to="/collection" />
      {state.kind === 'loading' && <Spinner label={t('collection.loading')} />}
      {state.kind === 'error' && <p className="text-14 text-muted">{t('collection.error')}</p>}
      {state.kind === 'ready' && byRarity !== null && (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="font-display text-[34px] leading-[1.1] font-extrabold text-gold-bright">{state.owned}</span>
            <span className="text-15 font-semibold text-muted">{t('home.collectionOf', { total: state.total })}</span>
          </p>
          <div
            role="progressbar"
            aria-label={t('collection.progress', { owned: state.owned, total: state.total })}
            aria-valuemin={0}
            aria-valuemax={state.total}
            aria-valuenow={state.owned}
            className="h-2 overflow-hidden rounded-pill bg-sunken"
          >
            <div className="h-full rounded-pill bg-gold" style={{ width: `${state.total === 0 ? 0 : Math.round((state.owned / state.total) * 100)}%` }} />
          </div>
          <ul className="flex flex-col gap-2 text-14">
            {RARITIES.map((rarity) => (
              <li key={rarity} data-rarity={rarity} className="flex items-center gap-2.5">
                <span aria-hidden="true" className={`size-2.5 rotate-45 ${RARITY_FRAME[rarity].gem}`} />
                <span className="grow">{t(`collection.rarityFilter.${rarity}`)}</span>
                <span className="font-bold">{byRarity[rarity]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <span className="grow" />
      <Link
        to="/collection"
        className="flex h-10 items-center justify-center rounded-10 bg-elevated text-14 font-bold text-primary shadow-edge-elevated hover:brightness-110"
      >
        {t('home.browseCards')}
      </Link>
    </section>
  );
}

/** Classifica in breve: il podio e, se è fra i primi dieci, la propria riga (P2-20 per il resto). */
export function RankingCard() {
  const { t } = useTranslation();
  const selfId = useAuth((s) => s.account?.id ?? null);
  const { state } = useLeaderboard();
  const entries = state.kind === 'ready' ? state.entries : [];
  const own = entries.find((entry) => entry.id === selfId && entry.rank > 3);
  const shown = [...entries.slice(0, 3), ...(own === undefined ? [] : [own])];

  return (
    <section data-ranking-card className="flex flex-col gap-1.5 rounded-16 bg-panel p-[18px]">
      <CardTitle icon="ranking" title={t('nav.ranking')} />
      {state.kind === 'loading' && <Spinner label={t('leaderboard.loading')} />}
      {state.kind === 'error' && <p className="text-14 text-muted">{t('leaderboard.error')}</p>}
      {state.kind === 'ready' &&
        (shown.length === 0 ? <p className="text-14 text-muted">{t('leaderboard.empty')}</p> : <RankingRows entries={shown} selfId={selfId} compact />)}
      <span className="grow" />
      <Link
        to="/leaderboard"
        className="flex h-10 items-center justify-center rounded-10 bg-elevated text-14 font-bold text-primary shadow-edge-elevated hover:brightness-110"
      >
        {t('home.fullRanking')}
      </Link>
    </section>
  );
}
