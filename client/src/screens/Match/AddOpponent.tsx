import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { useMatch } from '../../store/MatchProvider';
import { httpErrorMessage } from '../Auth/errorMessage';
import { useFriendActions } from '../Friends/useFriendActions';
import { relationOf, useFriends } from '../Friends/useFriends';

/**
 * Fine partita (A7): «Aggiungi agli amici» per l'avversario appena affrontato, se non è già amico né c'è una richiesta
 * inviata; con una richiesta ricevuta da lui, «Accetta la sua richiesta». Dopo l'invio resta «Richiesta inviata».
 */
export function AddOpponent() {
  const { t } = useTranslation();
  const myColor = useMatch((s) => s.myColor);
  const players = useMatch((s) => s.game?.players ?? null);
  const friends = useFriends();
  const actions = useFriendActions(friends.replace);
  const opponent = myColor === null || players === null ? null : players[myColor === 'white' ? 'black' : 'white'];
  // Il bot non è un giocatore da aggiungere agli amici.
  if (opponent === null || opponent.bot !== undefined || friends.state.kind !== 'ready') return null;

  const { relation } = relationOf(friends.state.list, opponent.id);
  if (relation === 'friend') return null;
  if (relation === 'outgoing') {
    return (
      <p data-add-opponent="sent" className="text-14 font-bold text-muted">
        {t('match.over.requestSent', { name: opponent.username })}
      </p>
    );
  }
  const incoming = relation === 'incoming';
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        fullWidth
        data-add-opponent={relation}
        disabled={actions.busy === opponent.id}
        onClick={() => void (incoming ? actions.accept(opponent.id) : actions.request(opponent.id))}
      >
        {t(incoming ? 'match.over.acceptFriend' : 'match.over.addFriend', { name: opponent.username })}
      </Button>
      {actions.error !== null && (
        <p role="alert" className="text-13 text-danger">
          {httpErrorMessage(t, actions.error.info)}
        </p>
      )}
    </div>
  );
}
