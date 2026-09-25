import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { Api } from '../api/endpoints';
import type { Auth, AuthState } from './authStore';

const AuthContext = createContext<Auth | null>(null);

/** Rende disponibili sessione e API ai componenti. L'istanza si crea in `main.tsx` (o nei test). */
export function AuthProvider({ auth, children }: { auth: Auth; children: ReactNode }) {
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

function useAuthContext(): Auth {
  const auth = useContext(AuthContext);
  if (auth === null) throw new Error('AuthProvider mancante');
  return auth;
}

export function useAuth<T>(selector: (state: AuthState) => T): T {
  return useStore(useAuthContext().store, selector);
}

export function useApi(): Api {
  return useAuthContext().api;
}
