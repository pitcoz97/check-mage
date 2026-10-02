import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GameHistoryEntry, PublicProfile } from '../../api/types';
import { Spinner } from '../../design/components/Spinner';
import { useApi } from '../../store/AuthProvider';

/** Pezzi condivisi dal proprio profilo e da quello degli altri giocatori. */

const DATE_SHORT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

/** Vittorie, sconfitte, patte e partite (`GET /users/{id}`). */
export function StatsGrid({ stats }: { stats: PublicProfile['stats'] }) {
  const { t } = useTranslation();
  const items = [
    ['wins', stats.wins],
    ['losses', stats.losses],
    ['draws', stats.draws],
    ['total', stats.total],
  ] as const;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('profile.stats')}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-5">
        {items.map(([key, value]) => (
          <div key={key} data-stat={key} className="flex flex-col-reverse gap-1 rounded-16 bg-panel p-[18px]">
            <dt className="text-12 font-bold tracking-[0.08em] text-muted uppercase">{t(`profile.${key}`)}</dt>
            <dd className="font-display text-[34px] leading-none font-extrabold text-gold-bright">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type GameOutcome = 'win' | 'loss' | 'draw' | 'unknown';

const OUTCOME_CHIP: Record<GameOutcome, string> = {
  win: 'bg-play text-on-play',
  loss: 'bg-danger-surface text-on-danger',
  draw: 'bg-quiet text-primary',
  unknown: 'bg-quiet text-muted',
};

/** Esito della partita per il giocatore: il lato dagli id, o dal nome sui server che non li mandano. */
export function outcomeFor(
  game: GameHistoryEntry,
  userId: string,
  username: string,
): { outcome: GameOutcome; opponent: string; opponentDeleted: boolean } {
  const white = game.whiteId === null ? game.white === username : game.whiteId === userId;
  const opponent = white ? game.black : game.white;
  const opponentDeleted = white ? game.blackDeleted : game.whiteDeleted;
  if (game.result === '1/2-1/2') return { outcome: 'draw', opponent, opponentDeleted };
  if (game.result === 'unknown') return { outcome: 'unknown', opponent, opponentDeleted };
  return { outcome: (game.result === '1-0') === white ? 'win' : 'loss', opponent, opponentDeleted };
}

type GamesState = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly games: readonly GameHistoryEntry[] };

/** Le ultime partite del giocatore (`GET /users/{id}/games`), con l'etichetta «Amichevole» (F8). */
export function RecentGames({ userId, username, limit = 10 }: { userId: string; username: string; limit?: number }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [state, setState] = useState<GamesState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void api.fetchGameHistory(userId).then((result) => {
      if (active) setState(result.ok ? { kind: 'ready', games: result.value.slice(0, limit) } : { kind: 'error' });
    });
    return () => {
      active = false;
    };
  }, [api, userId, limit]);

  return (
    <section data-recent-games className="flex flex-col gap-3">
      <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('player.recentGames')}</h2>
      {state.kind === 'loading' && <Spinner label={t('player.loading')} />}
      {state.kind === 'error' && <p className="text-14 text-muted">{t('player.gamesError')}</p>}
      {state.kind === 'ready' && state.games.length === 0 && <p className="text-14 text-muted">{t('player.noGames')}</p>}
      {state.kind === 'ready' && state.games.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {state.games.map((game) => {
            const { outcome, opponent, opponentDeleted } = outcomeFor(game, userId, username);
            const date = new Date(game.playedAt);
            return (
              <li key={game.id} data-game={game.id} data-outcome={outcome} className="flex items-center gap-3 rounded-10 bg-panel px-3 py-2 text-14">
                <span className={`w-[84px] shrink-0 rounded-8 py-1 text-center text-12 font-extrabold ${OUTCOME_CHIP[outcome]}`}>{t(`player.result.${outcome}`)}</span>
                <span className="min-w-0 grow truncate font-semibold">{t('player.against', { name: opponentDeleted ? t('player.deletedPlayer') : opponent })}</span>
                {!game.rated && <span className="rounded-pill bg-arcane-deep px-2 py-0.5 text-11 font-bold text-arcane-pale">{t('player.friendly')}</span>}
                {!Number.isNaN(date.getTime()) && <span className="shrink-0 text-12 text-muted">{date.toLocaleDateString(i18n.language, DATE_SHORT)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
