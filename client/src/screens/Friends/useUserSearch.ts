import { useCallback, useEffect, useState } from 'react';

import type { UserSearchResult } from '../../api/types';
import { useApi } from '../../store/AuthProvider';

/** Attesa dopo l'ultima battuta prima di cercare. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Lunghezza minima della ricerca sul server (`handlers.MinSearchLength`). */
export const SEARCH_MIN_LENGTH = 2;

export type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'short' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly results: readonly UserSearchResult[] };

/**
 * Ricerca dei giocatori per nome (`GET /users/search`, A5), `SEARCH_DEBOUNCE_MS` dopo l'ultima battuta. `refresh`
 * la ripete subito (dopo un'azione, per aggiornare le relazioni).
 */
export function useUserSearch(query: string): { state: SearchState; refresh(): void } {
  const api = useApi();
  const trimmed = query.trim();
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  const search = useCallback(async (q: string): Promise<SearchState> => {
    const result = await api.searchUsers(q);
    return result.ok ? { kind: 'ready', results: result.value } : { kind: 'error' };
  }, [api]);

  useEffect(() => {
    if (trimmed === '') {
      setState({ kind: 'idle' });
      return;
    }
    if ([...trimmed].length < SEARCH_MIN_LENGTH) {
      setState({ kind: 'short' });
      return;
    }
    let active = true;
    setState((previous) => (previous.kind === 'ready' ? previous : { kind: 'loading' }));
    const timer = setTimeout(() => {
      void search(trimmed).then((next) => {
        if (active) setState(next);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [trimmed, search, attempt]);

  return { state, refresh: () => setAttempt((n) => n + 1) };
}
