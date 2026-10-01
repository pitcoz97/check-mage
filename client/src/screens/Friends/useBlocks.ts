import { useEffect, useState } from 'react';

import type { BlockedUser, HttpErrorInfo } from '../../api/types';
import { useApi } from '../../store/AuthProvider';

export type BlocksState = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly blocked: readonly BlockedUser[] };

/** Giocatori bloccati (`GET /me/blocks`, A8), con blocco e sblocco: ogni risposta è la lista aggiornata. */
export function useBlocks() {
  const api = useApi();
  const [state, setState] = useState<BlocksState>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<HttpErrorInfo | null>(null);

  useEffect(() => {
    let active = true;
    void api.fetchBlocks().then((result) => {
      if (active) setState(result.ok ? { kind: 'ready', blocked: result.value } : { kind: 'error' });
    });
    return () => {
      active = false;
    };
  }, [api]);

  async function run(userId: string, call: (id: string) => ReturnType<typeof api.blockUser>): Promise<boolean> {
    setBusy(userId);
    setError(null);
    const result = await call(userId);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setState({ kind: 'ready', blocked: result.value });
    return true;
  }

  return {
    state,
    busy,
    error,
    isBlocked: (userId: string) => state.kind === 'ready' && state.blocked.some((b) => b.id === userId),
    block: (userId: string) => run(userId, (id) => api.blockUser(id)),
    unblock: (userId: string) => run(userId, (id) => api.unblockUser(id)),
  };
}
