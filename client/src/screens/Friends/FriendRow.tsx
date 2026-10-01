import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Friend } from '../../api/types';
import { FriendAvatar } from './FriendAvatar';

/** Colore della parola di stato, come il pallino. */
const STATUS_TEXT: Record<Friend['status'], string> = {
  online: 'text-play-bright',
  playing: 'text-arcane-bright',
  offline: 'text-muted',
};

/**
 * Riga di un amico: avatar con lo stato, nome, stato a parole ed ELO, «Sfida» (solo online) e «Profilo». In versione
 * `compact` (card della home) niente ELO né «Profilo»: il nome porta al profilo.
 */
export function FriendRow({
  friend,
  canChallenge,
  sending,
  onChallenge,
  compact = false,
}: {
  friend: Friend;
  canChallenge: boolean;
  sending: boolean;
  onChallenge: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const profile = `/players/${friend.id}`;
  const challengeable = friend.status === 'online' && canChallenge;

  return (
    <li data-friend={friend.id} data-status={friend.status} className={`flex items-center gap-3 ${compact ? 'py-1' : 'rounded-12 bg-panel px-3 py-2.5 lg:px-4'}`}>
      <FriendAvatar name={friend.username} status={friend.status} />
      <Link to={profile} className="flex min-w-0 grow flex-col gap-px text-primary">
        <span className={`truncate font-bold ${compact ? 'text-14' : 'text-15'}`}>{friend.username}</span>
        <span className="flex items-center gap-2 text-12">
          <span className={`font-bold ${STATUS_TEXT[friend.status]}`}>{t(`friends.status.${friend.status}`)}</span>
          {!compact && <span className="font-mono text-muted">{friend.elo}</span>}
        </span>
      </Link>
      {friend.status === 'online' && (
        <button
          type="button"
          data-action="challenge"
          disabled={!challengeable || sending}
          aria-label={t('friends.challengeName', { name: friend.username })}
          onClick={onChallenge}
          className={`flex shrink-0 items-center justify-center rounded-10 bg-play font-extrabold text-on-play shadow-edge-play hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
            compact ? 'h-9 px-3 text-13' : 'h-10 px-3.5 text-14'
          }`}
        >
          {t('friends.challenge')}
        </button>
      )}
      {!compact && (
        <Link
          to={profile}
          aria-label={t('friends.profileName', { name: friend.username })}
          className="hidden h-10 shrink-0 items-center rounded-10 bg-elevated px-3.5 text-14 font-bold text-primary shadow-edge-elevated hover:brightness-110 sm:flex"
        >
          {t('friends.profile')}
        </Link>
      )}
    </li>
  );
}
