import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { FriendStatus } from '../../api/types';
import { FriendAvatar } from './FriendAvatar';

/** Colore della parola di stato, come il pallino. */
const STATUS_TEXT: Record<FriendStatus, string> = {
  online: 'text-play-bright',
  playing: 'text-arcane-bright',
  offline: 'text-muted',
};

/** Pulsanti delle righe: «Sfida» verde, le altre azioni sul grigio della tavola. */
export const ROW_BUTTON = {
  play: 'bg-play font-extrabold text-on-play shadow-edge-play',
  secondary: 'bg-elevated font-bold text-primary shadow-edge-elevated',
} as const;

export function RowButton({
  tone = 'secondary',
  compact = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof ROW_BUTTON; compact?: boolean }) {
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center justify-center rounded-10 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${ROW_BUTTON[tone]} ${
        compact ? 'h-9 px-3 text-13' : 'h-10 px-3.5 text-14'
      } ${className}`}
      {...rest}
    />
  );
}

/** Un giocatore nelle righe: id, nome, ELO e, se si sa, lo stato. */
export interface RowPlayer {
  readonly id: string;
  readonly username: string;
  readonly elo: number;
  readonly status: FriendStatus | null;
}

/**
 * Riga di un giocatore: avatar con lo stato, nome, stato a parole ed ELO, «Sfida» (solo online e con `onChallenge`),
 * le azioni in `children` e «Profilo». In versione `compact` (card della home) niente ELO né «Profilo»: il nome porta
 * al profilo.
 */
export function FriendRow({
  friend,
  canChallenge = false,
  sending = false,
  onChallenge,
  compact = false,
  children,
}: {
  friend: RowPlayer;
  canChallenge?: boolean;
  sending?: boolean;
  onChallenge?: () => void;
  compact?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const profile = `/players/${friend.id}`;
  const challengeable = friend.status === 'online' && canChallenge;

  return (
    <li
      data-friend={friend.id}
      data-status={friend.status ?? undefined}
      className={`flex items-center gap-3 ${compact ? 'py-1' : 'flex-wrap rounded-12 bg-panel px-3 py-2.5 lg:flex-nowrap lg:px-4'}`}
    >
      <FriendAvatar name={friend.username} status={friend.status} />
      <Link to={profile} className="flex min-w-0 grow flex-col gap-px text-primary">
        <span className={`truncate font-bold ${compact ? 'text-14' : 'text-15'}`}>{friend.username}</span>
        <span className="flex items-center gap-2 text-12">
          {friend.status !== null && <span className={`font-bold ${STATUS_TEXT[friend.status]}`}>{t(`friends.status.${friend.status}`)}</span>}
          {!compact && <span className="font-mono text-muted">{friend.elo}</span>}
        </span>
      </Link>
      <span className="flex shrink-0 items-center gap-2">
        {onChallenge !== undefined && friend.status === 'online' && (
          <RowButton
            tone="play"
            compact={compact}
            data-action="challenge"
            disabled={!challengeable || sending}
            aria-label={t('friends.challengeName', { name: friend.username })}
            onClick={onChallenge}
          >
            {t('friends.challenge')}
          </RowButton>
        )}
        {children}
        {!compact && (
          <Link
            to={profile}
            aria-label={t('friends.profileName', { name: friend.username })}
            className={`hidden h-10 shrink-0 items-center rounded-10 px-3.5 text-14 hover:brightness-110 sm:flex ${ROW_BUTTON.secondary}`}
          >
            {t('friends.profile')}
          </Link>
        )}
      </span>
    </li>
  );
}
