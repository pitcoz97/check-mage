import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import type { HttpErrorInfo } from '../../api/types';
import { Button } from '../../design/components/Button';
import { TextField } from '../../design/components/TextField';
import { useAuth } from '../../store/AuthProvider';
import { readLoginState } from '../../app/guards';
import { httpErrorMessage } from './errorMessage';

/** Login via email (chess-server `handlers/auth.go:90`). Dopo il successo la guardia riporta alla pagina richiesta. */
export function Login() {
  const { t } = useTranslation();
  const location = useLocation();
  const state = readLoginState(location.state);
  const login = useAuth((s) => s.login);
  const notice = useAuth((s) => s.notice);

  const [email, setEmail] = useState(state.email ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<HttpErrorInfo | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await login(email.trim(), password);
    // Se il login riesce la guardia smonta questa schermata: niente aggiornamenti di stato dopo.
    if (!outcome.ok) {
      setError(outcome.error);
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-20 font-bold">{t('auth.loginTitle')}</h1>
        <p className="text-14 text-muted">{t('auth.loginLead')}</p>
      </div>

      {notice === 'session_expired' && error === null && (
        <p role="status" className="rounded-10 border border-subtle bg-elevated px-3 py-2 text-14">
          {t('session.expired')}
        </p>
      )}
      {state.accountCreated === true && error === null && (
        <p role="status" className="rounded-10 border border-subtle bg-elevated px-3 py-2 text-14">
          {t('auth.accountCreatedLoginFailed')}
        </p>
      )}

      <TextField
        label={t('auth.email')}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label={t('auth.password')}
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error !== null && (
        <p role="alert" className="text-14 text-danger">
          {httpErrorMessage(t, error)}
        </p>
      )}

      <Button type="submit" fullWidth disabled={submitting || email.trim() === '' || password === ''}>
        {submitting ? t('auth.submitting') : t('auth.submitLogin')}
      </Button>

      <Link to="/register" className="inline-flex min-h-[var(--hit-target)] items-center text-14 font-semibold text-accent hover:text-accent-hover">
        {t('auth.toRegister')}
      </Link>
    </form>
  );
}
