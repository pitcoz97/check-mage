import { useState } from 'react';

import type { ApiResult } from '../../api/endpoints';
import type { FriendList, HttpErrorInfo } from '../../api/types';
import { useApi } from '../../store/AuthProvider';
import { usePresence } from '../../store/PresenceProvider';

/**
 * Azioni sulle amicizie (A2–A4): richiesta, accetta, rifiuta o annulla, rimuovi. Ogni risposta è la lista aggiornata:
 * la passa a `onList` (e il badge delle richieste si aggiorna subito, senza aspettare il segnale di presenza).
 */
export function useFriendActions(onList: (list: FriendList) => void) {
  const api = useApi();
  const presence = usePresence();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ readonly userId: string; readonly info: HttpErrorInfo } | null>(null);

  async function run(userId: string, call: () => Promise<ApiResult<FriendList>>): Promise<boolean> {
    setBusy(userId);
    setError(null);
    const result = await call();
    setBusy(null);
    if (!result.ok) {
      setError({ userId, info: result.error });
      return false;
    }
    onList(result.value);
    presence.setFriendRequests(result.value.incoming.length);
    return true;
  }

  return {
    /** Id del giocatore su cui un'azione è in volo. */
    busy,
    /** Ultimo rifiuto del server, per il giocatore a cui si riferisce. */
    error,
    request: (userId: string) => run(userId, () => api.requestFriend(userId)),
    accept: (userId: string) => run(userId, () => api.acceptFriend(userId)),
    /** Rifiuta la richiesta ricevuta o annulla quella inviata. */
    deleteRequest: (userId: string) => run(userId, () => api.deleteFriendRequest(userId)),
    remove: (userId: string) => run(userId, () => api.removeFriend(userId)),
  };
}
