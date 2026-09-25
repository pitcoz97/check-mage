import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '../../design/components/AppIcon';
import { useAuth } from '../../store/AuthProvider';
import { useMatch, useMatchSession } from '../../store/MatchProvider';
import { RankingCard, SoonCard } from './HomeCards';
import { OngoingMatchCard } from './OngoingMatchCard';
import { PlayCard } from './PlayCard';

/** Partita salvata da una sessione precedente (ASSUMPTIONS C11): la home propone di riprenderla. */
function useSavedMatch(): boolean {
  const session = useMatchSession();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void session.hasSavedMatch().then((value) => {
      if (active) setSaved(value);
    });
    return () => {
      active = false;
    };
  }, [session]);
  return saved;
}

/**
 * La home (tavole "Home · desktop" e "Home · Android"): benvenuto e rating, partita in corso, "Gioca", e su desktop la
 * riga di card. Non rimanda più da sola alla partita: una partita in corso resta in background e si riprende dalla
 * sua card (D13); il passaggio coda → partita lo gestisce la shell.
 */
export function Lobby() {
  const { t } = useTranslation();
  const account = useAuth((s) => s.account);
  const lifecycle = useMatch((s) => s.lifecycle);
  const saved = useSavedMatch();
  const ongoing = lifecycle === 'playing' || (lifecycle === 'idle' && saved);

  return (
    <div className="flex grow flex-col gap-4 lg:gap-6">
      <header className="flex items-baseline gap-2.5 lg:h-12 lg:items-center lg:gap-3">
        <h1 className="font-display text-22 leading-tight font-bold tracking-[0.02em] lg:text-32">{t('home.welcome', { name: account?.username ?? '' })}</h1>
        <span className="grow" />
        {account !== null && (
          <span className="flex items-center gap-2 text-13 font-bold lg:h-10 lg:rounded-10 lg:bg-panel lg:px-3.5 lg:text-14">
            <AppIcon name="trophy" strokeWidth={2} className="hidden size-[18px] text-gold lg:block" />
            <span className="sr-only">{t('home.rating', { elo: account.elo })}</span>
            <span aria-hidden="true">{account.elo}</span>
          </span>
        )}
        <span
          aria-disabled="true"
          title={t('nav.soon')}
          className="hidden size-10 w-11 cursor-not-allowed items-center justify-center rounded-10 bg-panel text-tertiary opacity-60 lg:flex"
        >
          <AppIcon name="bell" className="size-5" />
          <span className="sr-only">
            {t('home.notifications')} · {t('nav.soon')}
          </span>
        </span>
      </header>

      {/* Android: partita in corso compatta sopra "Gioca". */}
      {ongoing && (
        <div className="lg:hidden">
          <OngoingMatchCard variant="compact" />
        </div>
      )}

      <div className="flex flex-col gap-6 lg:h-[460px] lg:flex-row">
        {ongoing && (
          <div className="hidden lg:flex">
            <OngoingMatchCard variant="panel" />
          </div>
        )}
        <PlayCard wide={!ongoing} />
      </div>

      {/* Desktop: la riga di card. */}
      <div className="hidden grow grid-cols-4 gap-5 lg:grid">
        <SoonCard icon="decks" title={t('nav.decks')} />
        <SoonCard icon="collection" title={t('nav.collection')} />
        <RankingCard />
        <SoonCard icon="friends" title={t('nav.friends')} />
      </div>

      {/* Android: amici online, «Presto». */}
      <section aria-disabled="true" className="flex items-center gap-2 lg:hidden">
        <h2 className="grow text-12 font-extrabold tracking-[0.1em] text-muted uppercase">{t('home.friendsOnline')}</h2>
        <span className="rounded-pill bg-quiet px-2 py-0.5 text-11 font-bold text-muted">{t('nav.soon')}</span>
      </section>
    </div>
  );
}
