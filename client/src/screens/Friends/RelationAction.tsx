import { useTranslation } from 'react-i18next';

import type { Relation } from '../../api/types';
import { RowButton } from './FriendRow';
import type { useFriendActions } from './useFriendActions';

type FriendActions = ReturnType<typeof useFriendActions>;

/**
 * L'azione d'amicizia che la relazione permette (A2–A4): «Aggiungi», «Annulla richiesta», «Accetta» e «Rifiuta», o
 * l'etichetta «Amico». `onDone` segue un'azione riuscita (per esempio per ripetere la ricerca).
 */
export function RelationAction({
  userId,
  username,
  relation,
  actions,
  compact = false,
  onDone,
}: {
  userId: string;
  username: string;
  relation: Relation;
  actions: FriendActions;
  compact?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const busy = actions.busy === userId;
  const then = (done: Promise<boolean>) =>
    void done.then((ok) => {
      if (ok) onDone?.();
    });

  switch (relation) {
    case 'friend':
      return <span className="shrink-0 rounded-pill bg-quiet px-2.5 py-1 text-12 font-bold text-play-bright">{t('friends.add.friend')}</span>;
    case 'outgoing':
      return (
        <RowButton compact={compact} data-action="cancel-request" disabled={busy} aria-label={t('friends.add.cancelName', { name: username })} onClick={() => then(actions.deleteRequest(userId))}>
          {t('friends.add.cancel')}
        </RowButton>
      );
    case 'incoming':
      return (
        <>
          <RowButton tone="play" compact={compact} data-action="accept-request" disabled={busy} aria-label={t('friends.add.acceptName', { name: username })} onClick={() => then(actions.accept(userId))}>
            {t('friends.add.accept')}
          </RowButton>
          <RowButton compact={compact} data-action="decline-request" disabled={busy} aria-label={t('friends.add.declineName', { name: username })} onClick={() => then(actions.deleteRequest(userId))}>
            {t('friends.add.decline')}
          </RowButton>
        </>
      );
    default:
      return (
        <RowButton compact={compact} data-action="add-friend" disabled={busy} aria-label={t('friends.add.addName', { name: username })} onClick={() => then(actions.request(userId))}>
          {t('friends.add.add')}
        </RowButton>
      );
  }
}
