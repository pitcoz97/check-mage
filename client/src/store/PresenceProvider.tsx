import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { useApi } from './AuthProvider';
import { createPresence, type Presence, type PresenceState } from './presence';

const PresenceContext = createContext<Presence | null>(null);

/**
 * Segnale di presenza e sfide in arrivo (ASSUMPTIONS F2) per tutta l'app autenticata, partita compresa: si monta
 * sotto `RequireAuth` e si ferma al logout.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const presence = useMemo(() => createPresence({ sendPresence: () => api.sendPresence() }), [api]);
  useEffect(() => {
    presence.start();
    return () => presence.stop();
  }, [presence]);
  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>;
}

export function usePresence(): Presence {
  const presence = useContext(PresenceContext);
  if (presence === null) throw new Error('PresenceProvider mancante');
  return presence;
}

/** La presenza se c'è il provider, altrimenti null (componenti montati da soli nei test). */
export function usePresenceOptional(): Presence | null {
  return useContext(PresenceContext);
}

export function usePresenceState<T>(selector: (state: PresenceState) => T): T {
  return useStore(usePresence().store, selector);
}

/** Store vuoto per chi legge la presenza fuori dal provider (anteprime, test dei singoli componenti). */
const NO_PRESENCE = createStore<PresenceState>()(() => ({ incoming: [], receivedAt: null, friendRequests: 0 }));

/** Richieste d'amicizia ricevute (badge, A6); 0 fuori dal provider. */
export function useFriendRequestCount(): number {
  const presence = useContext(PresenceContext);
  return useStore(presence?.store ?? NO_PRESENCE, (s) => s.friendRequests);
}
