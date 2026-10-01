import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FRIEND_STATUSES, type Friend } from '../../api/types';
import { AppIcon } from '../../design/components/AppIcon';
import { Button } from '../../design/components/Button';
import { InfoBox } from '../../design/components/InfoBox';
import { Spinner } from '../../design/components/Spinner';
import { httpErrorMessage } from '../Auth/errorMessage';
import { FriendRow } from './FriendRow';
import { useChallenge } from './useChallenge';
import { useFriends } from './useFriends';

/**
 * Amici (ASSUMPTIONS F1–F7). La schermata non è disegnata: riprende la card «Amici online» della home nel linguaggio
 * del design (D20). Per ora gli amici sono tutti i giocatori; sezioni Online, In partita, Offline, con ricerca.
 */
export function Friends() {
  const { t } = useTranslation();
  const { state, retry } = useFriends();
  const challenges = useChallenge();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = state.kind === 'ready' ? state.list.friends.filter((f) => f.username.toLowerCase().includes(needle)) : [];

  const row = (friend: Friend) => (
    <FriendRow
      key={friend.id}
      friend={friend}
      canChallenge={challenges.canChallenge}
      sending={challenges.sending === friend.id}
      onChallenge={() => void challenges.challenge(friend)}
    />
  );

  return (
    <div className="flex max-w-3xl flex-col gap-5 lg:gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-22 font-bold tracking-[0.02em] lg:text-32">{t('friends.title')}</h1>
        <p className="text-15 text-muted">{t('friends.lead')}</p>
      </header>

      <label className="flex h-11 min-w-0 items-center gap-2 rounded-10 bg-panel px-3 shadow-ring-elevated lg:max-w-[320px] lg:gap-2.5 lg:px-3.5">
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

      {challenges.error !== null && (
        <InfoBox tone="danger" role="alert" data-challenge-error>
          {httpErrorMessage(t, challenges.error.info)}
        </InfoBox>
      )}

      {state.kind === 'loading' && <Spinner label={t('friends.loading')} />}
      {state.kind === 'error' && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert">{t('friends.error')}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            {t('friends.retry')}
          </Button>
        </div>
      )}
      {state.kind === 'ready' && state.list.friends.length === 0 && <p className="text-muted">{t('friends.empty')}</p>}
      {state.kind === 'ready' && state.list.friends.length > 0 && visible.length === 0 && <p className="text-muted">{t('friends.noMatch')}</p>}

      {FRIEND_STATUSES.map((status) => {
        const group = visible.filter((f) => f.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status} data-friends-section={status} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-12 font-extrabold tracking-[0.1em] text-muted uppercase">
              {t(`friends.status.${status}`)}
              <span className="rounded-pill bg-quiet px-2 py-0.5 text-11">{group.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">{group.map(row)}</ul>
          </section>
        );
      })}
    </div>
  );
}
