import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';

import type { PublicProfile } from '../../api/types';
import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { Panel } from '../../design/components/Panel';
import { Spinner } from '../../design/components/Spinner';
import { useApi, useAuth } from '../../store/AuthProvider';
import { httpErrorMessage } from '../Auth/errorMessage';
import { FriendAvatar } from '../Friends/FriendAvatar';
import { RowButton } from '../Friends/FriendRow';
import { RelationAction } from '../Friends/RelationAction';
import { useBlocks } from '../Friends/useBlocks';
import { useChallenge } from '../Friends/useChallenge';
import { useFriendActions } from '../Friends/useFriendActions';
import { relationOf, useFriends } from '../Friends/useFriends';
import { RecentGames, StatsGrid } from '../Profile/ProfileParts';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'long' };

type State = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly profile: PublicProfile };

/** Conferma in linea delle azioni che non si annullano da sole: rimuovere un amico, bloccare. */
type Confirm = 'remove' | 'block' | null;

/**
 * Profilo di un altro giocatore (`/players/:id`, F3, A7): avatar con lo stato, ELO, iscrizione, statistiche
 * (`GET /users/{id}`), ultime partite, «Sfida» se è online, le azioni d'amicizia della relazione (aggiungi, annulla,
 * accetta, rifiuta, rimuovi) e, nel menu «⋯», blocca o sblocca. Stato e relazione vengono dalla lista degli amici. Il
 * proprio id porta al proprio profilo.
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
  const actions = useFriendActions(friends.replace);
  const blocks = useBlocks();
  const challenges = useChallenge();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [menu, setMenu] = useState(false);

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

  /** Dopo un blocco o uno sblocco la lista cambia (relazione, altri giocatori): la si rilegge senza mostrare il caricamento. */
  const reloadFriends = () =>
    void api.fetchFriends().then((result) => {
      if (result.ok) friends.replace(result.value);
    });

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
  const { relation, status } = friends.state.kind === 'ready' ? relationOf(friends.state.list, user.id) : { relation: 'none' as const, status: null };
  const blocked = blocks.isBlocked(user.id);
  const joined = user.createdAt === null ? null : new Date(user.createdAt);
  const error = actions.error?.info ?? blocks.error ?? challenges.error?.info ?? null;

  return (
    <div data-player={user.id} className="flex max-w-3xl flex-col gap-6">
      {back}
      <header className="flex flex-wrap items-center gap-4">
        <FriendAvatar name={user.username} status={blocked ? null : status} size="lg" />
        <div className="flex min-w-0 grow flex-col gap-1.5">
          <h1 className="truncate font-display text-22 font-bold tracking-[0.02em] lg:text-32">{user.username}</h1>
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 rounded-10 bg-panel px-3 py-1.5 text-14 font-bold">
              <AppIcon name="trophy" strokeWidth={2} className="size-4 text-gold" />
              {t('nav.rating', { elo: user.elo })}
            </span>
            {status !== null && !blocked && <span className="text-13 font-bold text-muted">{t(`friends.status.${status}`)}</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!blocked && status === 'online' && (
            <Button data-action="challenge" disabled={!challenges.canChallenge || challenges.sending === user.id} onClick={() => void challenges.challenge(user)}>
              {t('friends.challengeName', { name: user.username })}
            </Button>
          )}
          {!blocked && friends.state.kind === 'ready' && <RelationAction userId={user.id} username={user.username} relation={relation} actions={actions} />}
          {!blocked && relation === 'friend' && (
            <RowButton data-action="remove-friend" onClick={() => setConfirm('remove')}>
              {t('player.remove')}
            </RowButton>
          )}
          <div className="relative">
            <RowButton aria-label={t('player.more')} aria-expanded={menu} data-action="player-menu" onClick={() => setMenu(!menu)} className="w-10 px-0">
              <AppIcon name="more" className="size-5" />
            </RowButton>
            {menu && (
              <div role="menu" className="absolute top-12 right-0 z-10 flex min-w-[160px] flex-col rounded-12 bg-elevated p-1.5 shadow-ring-elevated">
                <button
                  type="button"
                  role="menuitem"
                  data-action={blocked ? 'unblock' : 'block'}
                  className="rounded-8 px-3 py-2 text-left text-14 font-bold text-primary hover:bg-panel"
                  onClick={() => {
                    setMenu(false);
                    if (blocked) void blocks.unblock(user.id).then((ok) => ok && reloadFriends());
                    else setConfirm('block');
                  }}
                >
                  {blocked ? t('player.unblock') : t('player.block')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {blocked && (
        <InfoBox tone="neutral" role="status" data-blocked>
          {t('player.blockedNotice')}
        </InfoBox>
      )}

      {confirm !== null && (
        <InfoBox tone="danger" role="group" aria-label={t(confirm === 'remove' ? 'player.remove' : 'player.block')} data-confirm={confirm} className="flex flex-col gap-2.5">
          <span>{t(confirm === 'remove' ? 'player.removeConfirm' : 'player.blockConfirm', { name: user.username })}</span>
          <span className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setConfirm(null);
                if (confirm === 'remove') void actions.remove(user.id);
                else void blocks.block(user.id).then((ok) => ok && reloadFriends());
              }}
            >
              {t(confirm === 'remove' ? 'player.remove' : 'player.block')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
              {t('player.keep')}
            </Button>
          </span>
        </InfoBox>
      )}

      {error !== null && (
        <InfoBox tone="danger" role="alert" data-player-error>
          {httpErrorMessage(t, error)}
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
