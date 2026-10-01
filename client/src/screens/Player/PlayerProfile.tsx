import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';

import type { FriendStatus, PublicProfile } from '../../api/types';
import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useApi, useAuth } from '../../store/AuthProvider';
import { httpErrorMessage } from '../Auth/errorMessage';
import { FriendAvatar } from '../Friends/FriendAvatar';
import { useChallenge } from '../Friends/useChallenge';
import { useFriends } from '../Friends/useFriends';
import { RecentGames, StatsGrid } from '../Profile/ProfileParts';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'long' };

type State = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly profile: PublicProfile };

/**
 * Profilo di un altro giocatore (`/players/:id`, F3): avatar con lo stato, ELO, iscrizione, statistiche
 * (`GET /users/{id}`), ultime partite e «Sfida» se è online. Lo stato viene dalla lista degli amici. Il proprio id
 * porta al proprio profilo.
 */
export function PlayerProfile() {
  const { id = '' } = useParams();
  const selfId = useAuth((s) => s.account?.id ?? null);
  if (id === selfId) return <Navigate to="/profile" replace />;
  return <PlayerProfileView key={id} id={id} />;
}

function PlayerProfileView({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const friends = useFriends();
  const challenges = useChallenge();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async (): Promise<State> => {
    const result = await api.fetchPublicProfile(id);
    return result.ok ? { kind: 'ready', profile: result.value } : { kind: 'error' };
  }, [api, id]);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [load]);

  const back = (
    <Link to="/friends" className="flex items-center gap-1.5 self-start text-14 font-bold text-muted hover:text-primary">
      <AppIcon name="chevron" strokeWidth={2.2} className="size-4 rotate-180" />
      {t('player.back')}
    </Link>
  );

  if (state.kind === 'loading') {
    return (
      <div className="flex justify-center py-10">
        <Spinner label={t('player.loading')} />
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        {back}
        <Panel className="flex flex-col items-start gap-3 rounded-16 p-5">
          <p role="alert">{t('player.loadError')}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState({ kind: 'loading' });
              void load().then(setState);
            }}
          >
            {t('player.retry')}
          </Button>
        </Panel>
      </div>
    );
  }

  const { user, stats } = state.profile;
  const status: FriendStatus | null = friends.state.kind === 'ready' ? (friends.state.list.friends.find((f) => f.id === user.id)?.status ?? null) : null;
  const joined = user.createdAt === null ? null : new Date(user.createdAt);

  return (
    <div data-player={user.id} className="flex max-w-3xl flex-col gap-6">
      {back}
      <header className="flex flex-wrap items-center gap-4">
        <FriendAvatar name={user.username} status={status} size="lg" />
        <div className="flex min-w-0 grow flex-col gap-1.5">
          <h1 className="truncate font-display text-22 font-bold tracking-[0.02em] lg:text-32">{user.username}</h1>
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 rounded-10 bg-panel px-3 py-1.5 text-14 font-bold">
              <AppIcon name="trophy" strokeWidth={2} className="size-4 text-gold" />
              {t('nav.rating', { elo: user.elo })}
            </span>
            {status !== null && <span className="text-13 font-bold text-muted">{t(`friends.status.${status}`)}</span>}
          </span>
        </div>
        {status === 'online' && (
          <Button
            data-action="challenge"
            disabled={!challenges.canChallenge || challenges.sending === user.id}
            onClick={() => void challenges.challenge(user)}
          >
            {t('friends.challengeName', { name: user.username })}
          </Button>
        )}
      </header>

      {challenges.error !== null && (
        <InfoBox tone="danger" role="alert" data-challenge-error>
          {httpErrorMessage(t, challenges.error.info)}
        </InfoBox>
      )}

      {joined !== null && !Number.isNaN(joined.getTime()) && (
        <p className="text-14 text-muted">
          {t('profile.memberSince')} {joined.toLocaleDateString(i18n.language, DATE_FORMAT)}
        </p>
      )}

      <StatsGrid stats={stats} />
      <RecentGames userId={user.id} username={user.username} />
    </div>
  );
}
