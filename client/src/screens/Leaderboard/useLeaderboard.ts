import { useCallback, useEffect, useState } from 'react';

import type { LeaderboardEntry } from '../../api/types';
import { useApi } from '../../store/AuthProvider';

export type LeaderboardState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly entries: readonly LeaderboardEntry[] };

/** Classifica da `GET /leaderboard`: i primi dieci, niente posizione propria né stagione (P2-20). */
export function useLeaderboard(): { state: LeaderboardState; retry(): void } {
  const api = useApi();
  const [state, setState] = useState<LeaderboardState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (): Promise<LeaderboardState> => {
    const result = await api.fetchLeaderboard();
    return result.ok ? { kind: 'ready', entries: result.value } : { kind: 'error' };
  }, [api]);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [load, attempt]);

  return {
    state,
    retry: () => {
      setState({ kind: 'loading' });
      setAttempt(attempt + 1);
    },
  };
}
