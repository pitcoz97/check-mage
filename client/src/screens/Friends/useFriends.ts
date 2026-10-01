import { useCallback, useEffect, useState } from 'react';

import type { Friend, FriendList, FriendStatus, Relation } from '../../api/types';
import { useApi } from '../../store/AuthProvider';

/** Ogni quanto si aggiorna la lista mentre è a schermo (la presenza sul server vale 30 s, F2). */
export const FRIENDS_REFRESH_MS = 15_000;

export type FriendsState = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly list: FriendList };

/**
 * Amici da `GET /me/friends` (F1–F3, A1–A3), aggiornati ogni `FRIENDS_REFRESH_MS`. Un aggiornamento fallito lascia la
 * lista che c'era: l'errore si mostra solo se non c'è ancora niente. `replace` mette la lista restituita da
 * un'azione (richiesta, accetta…) senza rileggerla.
 */
export function useFriends(refreshMs = FRIENDS_REFRESH_MS): { state: FriendsState; retry(): void; replace(list: FriendList): void } {
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
    replace: (list) => setState({ kind: 'ready', list }),
  };
}

/** Amici veri e poi gli altri giocatori: chi si può sfidare, nell'ordine della card della home. */
export function challengeable(list: FriendList): readonly Friend[] {
  return [...list.friends, ...list.others];
}

/** Relazione e stato di un giocatore secondo la lista: amico, richiesta ricevuta o inviata, altro giocatore o nessuno. */
export function relationOf(list: FriendList, id: string): { relation: Relation; status: FriendStatus | null } {
  const find = (items: readonly Friend[]) => items.find((f) => f.id === id);
  const friend = find(list.friends);
  if (friend !== undefined) return { relation: 'friend', status: friend.status };
  const incoming = find(list.incoming);
  if (incoming !== undefined) return { relation: 'incoming', status: incoming.status };
  const outgoing = find(list.outgoing);
  if (outgoing !== undefined) return { relation: 'outgoing', status: outgoing.status };
  return { relation: 'none', status: find(list.others)?.status ?? null };
}
