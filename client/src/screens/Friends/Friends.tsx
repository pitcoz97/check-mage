import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FRIEND_STATUSES, type Friend } from '../../api/types';
import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { Spinner } from '../../design/components/Spinner';
import { httpErrorMessage } from '../Auth/errorMessage';
import { FriendRow } from './FriendRow';
import { RelationAction } from './RelationAction';
import { useChallenge } from './useChallenge';
import { useFriendActions } from './useFriendActions';
import { useFriends } from './useFriends';
import { useUserSearch } from './useUserSearch';

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section data-friends-section={id} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-12 font-extrabold tracking-[0.1em] text-muted uppercase">
        {title}
        <span className="rounded-pill bg-quiet px-2 py-0.5 text-11">{count}</span>
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/**
 * Amici (ASSUMPTIONS F1–F10, A1–A10). La schermata non è disegnata: riprende la card «Amici online» della home nel
 * linguaggio del design (D20). Con il campo vuoto: richieste, amici per stato e, finché sul server tutti sono
 * sfidabili, gli altri giocatori. Scrivendo: la ricerca fra tutti i giocatori, con le azioni d'amicizia.
 */
export function Friends() {
  const { t } = useTranslation();
  const { state, retry, replace } = useFriends();
  const challenges = useChallenge();
  const [query, setQuery] = useState('');
  const search = useUserSearch(query);
  const actions = useFriendActions(replace);
  const list = state.kind === 'ready' ? state.list : null;
  const error = actions.error ?? challenges.error;

  const challengeRow = (friend: Friend, extra?: ReactNode) => (
    <FriendRow
      key={friend.id}
      friend={friend}
      canChallenge={challenges.canChallenge}
      sending={challenges.sending === friend.id}
      onChallenge={() => void challenges.challenge(friend)}
    >
      {extra}
    </FriendRow>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-5 lg:gap-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="flex grow flex-col gap-1">
          <h1 className="font-display text-22 font-bold tracking-[0.02em] lg:text-32">{t('friends.title')}</h1>
          <p className="text-15 text-muted">{t('friends.lead')}</p>
        </div>
        {list !== null && (
          <span data-friend-count className="rounded-10 bg-panel px-3 py-1.5 text-14 font-bold">
            {t('friends.count', { count: list.friends.length, max: list.maxFriends })}
          </span>
        )}
      </header>

      <label className="flex h-11 min-w-0 items-center gap-2 rounded-10 bg-panel px-3 shadow-ring-elevated lg:max-w-[360px] lg:gap-2.5 lg:px-3.5">
        <AppIcon name="search" strokeWidth={2} className="size-[17px] shrink-0 text-muted lg:size-[18px]" />
        <input
          type="search"
          value={query}
          aria-label={t('friends.search')}
          placeholder={t('friends.search')}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 min-w-0 grow bg-transparent text-15 text-primary outline-none placeholder:text-faint"
        />
      </label>

      {error !== null && (
        <InfoBox tone="danger" role="alert" data-friends-error>
          {httpErrorMessage(t, error.info)}
        </InfoBox>
      )}

      {search.state.kind !== 'idle' ? (
        <SearchResults state={search.state} actions={actions} onDone={search.refresh} />
      ) : (
        <>
          {state.kind === 'loading' && <Spinner label={t('friends.loading')} />}
          {state.kind === 'error' && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert">{t('friends.error')}</p>
              <Button variant="secondary" size="sm" onClick={retry}>
                {t('friends.retry')}
              </Button>
            </div>
          )}
          {list !== null && (
            <>
              {list.incoming.length > 0 && (
                <Section id="incoming" title={t('friends.requests.incoming')} count={list.incoming.length}>
                  {list.incoming.map((friend) => (
                    <FriendRow key={friend.id} friend={friend}>
                      <RelationAction userId={friend.id} username={friend.username} relation="incoming" actions={actions} />
                    </FriendRow>
                  ))}
                </Section>
              )}
              {list.outgoing.length > 0 && (
                <Section id="outgoing" title={t('friends.requests.outgoing')} count={list.outgoing.length}>
                  {list.outgoing.map((friend) => (
                    <FriendRow key={friend.id} friend={friend}>
                      <RelationAction userId={friend.id} username={friend.username} relation="outgoing" actions={actions} />
                    </FriendRow>
                  ))}
                </Section>
              )}
              {list.friends.length === 0 && <p className="text-muted">{t('friends.none')}</p>}
              {FRIEND_STATUSES.map((status) => {
                const group = list.friends.filter((f) => f.status === status);
                if (group.length === 0) return null;
                return (
                  <Section key={status} id={status} title={t(`friends.status.${status}`)} count={group.length}>
                    {group.map((friend) => challengeRow(friend))}
                  </Section>
                );
              })}
              {list.others.length > 0 && (
                <Section id="others" title={t('friends.others')} count={list.others.length}>
                  {list.others.map((friend) =>
                    challengeRow(friend, <RelationAction userId={friend.id} username={friend.username} relation="none" actions={actions} />),
                  )}
                </Section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SearchResults({
  state,
  actions,
  onDone,
}: {
  state: Exclude<ReturnType<typeof useUserSearch>['state'], { kind: 'idle' }>;
  actions: ReturnType<typeof useFriendActions>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  if (state.kind === 'short') return <p className="text-muted">{t('errors.http.search_too_short')}</p>;
  if (state.kind === 'loading') return <Spinner label={t('friends.add.searching')} />;
  if (state.kind === 'error') return <p role="alert">{t('friends.add.error')}</p>;
  if (state.results.length === 0) return <p className="text-muted">{t('friends.noMatch')}</p>;
  return (
    <Section id="search" title={t('friends.add.results')} count={state.results.length}>
      {state.results.map((user) => (
        <FriendRow key={user.id} friend={{ ...user, status: null }}>
          <RelationAction userId={user.id} username={user.username} relation={user.relation} actions={actions} onDone={onDone} />
        </FriendRow>
      ))}
    </Section>
  );
}
