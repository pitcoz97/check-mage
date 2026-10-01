import { useState } from 'react';

import type { HttpErrorInfo } from '../../api/types';
import { useApi } from '../../store/AuthProvider';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';

/**
 * Sfidare un amico (F4–F7): `POST /me/challenges`, poi la sessione si collega a `/ws?challenge=<id>` e aspetta.
 * Non si sfida durante una partita, né mentre una sfida è già in corso di collegamento.
 */
export function useChallenge() {
  const api = useApi();
  const session = useMatchSession();
  const lifecycle = useMatch((s) => s.lifecycle);
  const pending = useSessionStatus((s) => s.pending);
  const connection = useSessionStatus((s) => s.connection.kind);
  // Una sfida chiusa (rifiutata, scaduta…) o fermata non conta più: se ne può mandare un’altra.
  const waiting = pending?.kind === 'challenge' && (connection === 'connecting' || connection === 'open' || connection === 'reconnecting');
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<{ readonly userId: string; readonly info: HttpErrorInfo } | null>(null);

  async function challenge(friend: { readonly id: string; readonly username: string }): Promise<void> {
    setSending(friend.id);
    setError(null);
    const result = await api.createChallenge(friend.id);
    setSending(null);
    if (!result.ok) {
      setError({ userId: friend.id, info: result.error });
      return;
    }
    session.joinChallenge(result.value.id, friend.username, 'sent');
  }

  return {
    challenge,
    /** Id dell'amico che si sta sfidando, mentre la richiesta è in volo. */
    sending,
    /** Ultimo rifiuto del server, per l'amico a cui si riferisce. */
    error,
    /** Si può sfidare: niente partita in corso né sfida già in collegamento. */
    canChallenge: lifecycle !== 'playing' && !waiting,
  };
}
