import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';

import { Button } from '../design/components/Button';
import { Spinner } from '../design/components/Spinner';
import { useAuth } from '../store/AuthProvider';

/** Stato di navigazione passato al login: pagina da riaprire, email da precompilare, account appena creato. */
export interface LoginRedirectState {
  readonly from?: string;
  readonly email?: string;
  readonly accountCreated?: boolean;
}

/** `location.state` arriva dalla history del browser: si legge campo per campo, senza fidarsi della forma. */
export function readLoginState(state: unknown): LoginRedirectState {
  if (typeof state !== 'object' || state === null) return {};
  const record = state as Record<string, unknown>;
  const from = record['from'];
  const email = record['email'];
  return {
    ...(typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? { from } : {}),
    ...(typeof email === 'string' ? { email } : {}),
    ...(record['accountCreated'] === true ? { accountCreated: true } : {}),
  };
}

/**
 * Radice dell'app: valida la sessione salvata con `GET /me` prima di mostrare qualsiasi schermata (briefing §7.1).
 */
export function SessionGate() {
  const { t } = useTranslation();
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'checking') {
    return (
      <div className="safe-area flex min-h-full items-center justify-center">
        <Spinner label={t('session.checking')} />
      </div>
    );
  }
  if (status === 'unreachable') {
    return (
      <div className="safe-area flex min-h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-bold">{t('session.unreachableTitle')}</h1>
        <p className="max-w-sm text-muted">{t('session.unreachableLead')}</p>
        <Button onClick={() => void bootstrap()}>{t('session.retry')}</Button>
      </div>
    );
  }
  return <Outlet />;
}

/** Rotte riservate: chi non è autenticato va al login, che poi riporta qui. */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status !== 'authenticated') {
    const state: LoginRedirectState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** Login e registrazione: chi è già autenticato prosegue verso la destinazione richiesta. */
export function GuestOnly() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'authenticated') {
    return <Navigate to={readLoginState(location.state).from ?? '/lobby'} replace />;
  }
  return <Outlet />;
}

export function RootRedirect() {
  const status = useAuth((s) => s.status);
  return <Navigate to={status === 'authenticated' ? '/lobby' : '/login'} replace />;
}
