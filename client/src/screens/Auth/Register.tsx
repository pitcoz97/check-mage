import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import type { HttpErrorCode, HttpErrorInfo } from '../../api/types';
import type { LoginRedirectState } from '../../app/guards';
import { Button } from '../../design/components/Button';
import { TextField } from '../../design/components/TextField';
import { useAuth } from '../../store/AuthProvider';
import { allChecksPass, checkCredentials, CREDENTIAL_CHECKS } from './credentialChecks';
import { httpErrorMessage } from './errorMessage';

type Field = 'username' | 'email' | 'password';

/** Su quale campo mostrare un errore di validazione del server (`validation/validation.go`). */
function fieldOf(code: HttpErrorCode | null): Field | null {
  if (code === null) return null;
  if (code.startsWith('username_') && code !== 'username_or_email_taken') return 'username';
  if (code === 'email_invalid') return 'email';
  if (code.startsWith('password_')) return 'password';
  return null;
}

function RequirementIcon({ met }: { met: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-4 shrink-0 ${met ? 'text-accent' : 'text-muted'}`}>
      {met ? (
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

/** Registrazione (chess-server `handlers/auth.go:18`) con login automatico al termine. */
export function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const register = useAuth((s) => s.register);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<HttpErrorInfo | null>(null);

  const checks = useMemo(() => checkCredentials({ username, email, password }), [username, email, password]);
  const errorField = error === null ? null : fieldOf(error.code);
  const fieldError = (field: Field) => (error !== null && errorField === field ? httpErrorMessage(t, error) : null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !allChecksPass(checks)) return;
    setSubmitting(true);
    setError(null);
    // Il server valida lo username dopo il trim ma lo salva così com'è: si invia già ripulito.
    const outcome = await register(username.trim(), email.trim(), password);
    if (outcome.ok) return; // la guardia porta in lobby
    if (outcome.stage === 'login') {
      const state: LoginRedirectState = { email: email.trim(), accountCreated: true };
      void navigate('/login', { replace: true, state });
      return;
    }
    setError(outcome.error);
    setSubmitting(false);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">{t('auth.registerTitle')}</h1>
        <p className="text-sm text-muted">{t('auth.registerLead')}</p>
      </div>

      <TextField
        label={t('auth.username')}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={username}
        error={fieldError('username')}
        onChange={(e) => setUsername(e.target.value)}
      />
      <TextField
        label={t('auth.email')}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        error={fieldError('email')}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label={t('auth.password')}
        type="password"
        name="password"
        autoComplete="new-password"
        required
        value={password}
        error={fieldError('password')}
        onChange={(e) => setPassword(e.target.value)}
      />

      <section aria-labelledby="requirements-title" className="flex flex-col gap-1">
        <h2 id="requirements-title" className="text-sm font-semibold">
          {t('auth.requirements')}
        </h2>
        <ul className="flex flex-col gap-1">
          {CREDENTIAL_CHECKS.map((check) => (
            <li key={check} data-check={check} data-met={checks[check]} className="flex items-center gap-2 text-sm">
              <RequirementIcon met={checks[check]} />
              <span className={checks[check] ? 'text-primary' : 'text-muted'}>{t(`auth.checks.${check}`)}</span>
              <span className="sr-only">{checks[check] ? t('auth.requirementMet') : t('auth.requirementUnmet')}</span>
            </li>
          ))}
        </ul>
      </section>

      {error !== null && errorField === null && (
        <p role="alert" className="text-sm text-danger">
          {httpErrorMessage(t, error)}
        </p>
      )}

      <Button type="submit" fullWidth disabled={submitting || !allChecksPass(checks)}>
        {submitting ? t('auth.submitting') : t('auth.submitRegister')}
      </Button>

      <Link to="/login" className="inline-flex min-h-[var(--hit-target)] items-center text-sm font-semibold text-accent hover:text-accent-hover">
        {t('auth.toLogin')}
      </Link>
    </form>
  );
}
