import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { MatchSession, SessionState } from './matchSession';
import type { MatchStoreState } from './matchStore';

const MatchContext = createContext<MatchSession | null>(null);

/** Rende disponibile la sessione di partita. L'istanza si crea in `main.tsx` (o nei test). */
export function MatchProvider({ session, children }: { session: MatchSession; children: ReactNode }) {
  return <MatchContext.Provider value={session}>{children}</MatchContext.Provider>;
}

export function useMatchSession(): MatchSession {
  const session = useContext(MatchContext);
  if (session === null) throw new Error('MatchProvider mancante');
  return session;
}

export function useMatch<T>(selector: (state: MatchStoreState) => T): T {
  return useStore(useMatchSession().match, selector);
}

export function useSessionStatus<T>(selector: (state: SessionState) => T): T {
  return useStore(useMatchSession().status, selector);
}
