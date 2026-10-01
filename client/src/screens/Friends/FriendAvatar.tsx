import type { FriendStatus } from '../../api/types';

/** Colore del pallino di stato: verde online come nella tavola, viola in partita, spento offline. */
const DOT: Record<FriendStatus, string> = {
  online: 'bg-play-bright',
  playing: 'bg-arcane',
  offline: 'bg-quiet',
};

const SIZE = {
  md: 'size-9 rounded-8 text-15',
  lg: 'size-16 rounded-12 text-28',
} as const;

/**
 * Avatar di un altro giocatore (REDESIGN_PLAN.md: avatar 36, raggio 8, iniziale in 800, viola scuro per gli altri)
 * col pallino di stato. Lo stato a parole lo dà la riga: qui è solo decorazione.
 */
export function FriendAvatar({ name, status, size = 'md' }: { name: string; status: FriendStatus | null; size?: keyof typeof SIZE }) {
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0">
      <span className={`flex items-center justify-center bg-arcane-deep font-extrabold text-primary ${SIZE[size]}`}>{name.slice(0, 1).toUpperCase()}</span>
      {status !== null && (
        <span data-status-dot={status} className={`absolute -right-1 -bottom-1 rounded-pill ring-[3px] ring-panel ${size === 'lg' ? 'size-4' : 'size-3'} ${DOT[status]}`} />
      )}
    </span>
  );
}
