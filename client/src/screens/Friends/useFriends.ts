import { useCallback, useEffect, useState } from 'react';

import type { FriendList } from '../../api/types';
import { useApi } from '../../store/AuthProvider';

/** Ogni quanto si aggiorna la lista mentre è a schermo (la presenza sul server vale 30 s, F2). */
export const FRIENDS_REFRESH_MS = 15_000;

export type FriendsState = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly list: FriendList };

/**
 * Amici da `GET /me/friends` (F1–F3), aggiornati ogni `FRIENDS_REFRESH_MS`. Un aggiornamento fallito lascia la lista
 * che c'era: l'errore si mostra solo se non c'è ancora niente.
 */
export function useFriends(refreshMs = FRIENDS_REFRESH_MS): { state: FriendsState; retry(): void } {
  const api = useApi();
  const [state, setState] = useState<FriendsState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => api.fetchFriends(), [api]);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void load().then((result) => {
        if (!active) return;
        if (result.ok) setState({ kind: 'ready', list: result.value });
        else setState((previous) => (previous.kind === 'ready' ? previous : { kind: 'error' }));
      });
    refresh();
    const timer = setInterval(refresh, refreshMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load, attempt, refreshMs]);

  return {
    state,
    retry: () => {
      setState({ kind: 'loading' });
      setAttempt(attempt + 1);
    },
  };
}
