import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AppIcon, type AppIconName } from '../../design/components/AppIcon';
import { Spinner } from '../../design/components/Spinner';
import { useAuth } from '../../store/AuthProvider';
import { RankingRows } from '../Leaderboard/RankingRows';
import { useLeaderboard } from '../Leaderboard/useLeaderboard';

/**
 * La riga di card in fondo alla home desktop (tavola "Home · desktop"). Mazzi, Collezione e Amici non hanno dati sul
 * server: la card c'è, con «Presto» e nessun dato finto (D9). La Classifica è vera (D11).
 */

function CardTitle({ icon, title, trailing }: { icon: AppIconName; title: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-8 bg-elevated text-gold">
        <AppIcon name={icon} className="size-[18px]" />
      </span>
      <h3 className="grow font-display text-18 font-bold">{title}</h3>
      {trailing}
    </div>
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
