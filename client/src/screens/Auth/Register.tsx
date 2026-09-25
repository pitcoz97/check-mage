import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { FALLBACK_CREDENTIAL_POLICY } from '../../api/adapter';
import type { CredentialPolicy, HttpErrorCode, HttpErrorInfo } from '../../api/types';
import type { LoginRedirectState } from '../../app/guards';
import { Button } from '../../design/components/Button';
import { TextField } from '../../design/components/TextField';
import { useApi, useAuth } from '../../store/AuthProvider';
import { allChecksPass, checkCredentials, requiredChecks, type CredentialCheck } from './credentialChecks';
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

/** Limiti da interpolare nell'etichetta di un requisito; le etichette senza numeri li ignorano. */
function checkParams(check: CredentialCheck, policy: CredentialPolicy): { min: number; max: number } {
  if (check === 'usernameLength') return { min: policy.username.minLength, max: policy.username.maxLength };
  if (check === 'passwordLength') return { min: policy.password.minBytes, max: policy.password.maxBytes };
  return { min: 0, max: 0 };
}

/**
 * Requisiti da `GET /auth/password-policy`: finché non arrivano (o se la chiamata fallisce) vale la riserva
 * dell'adapter, che ha gli stessi valori del server.
 */
function usePasswordPolicy(): CredentialPolicy {
  const api = useApi();
  const [policy, setPolicy] = useState<CredentialPolicy>(FALLBACK_CREDENTIAL_POLICY);
  useEffect(() => {
    let active = true;
    void api.fetchPasswordPolicy().then((result) => {
      if (active && result.ok) setPolicy(result.value);
    });
    return () => {
      active = false;
    };
  }, [api]);
  return policy;
}

function RequirementIcon({ met }: { met: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-4 shrink-0 ${met ? 'text-play-bright' : 'text-faint'}`}>
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
  const policy = usePasswordPolicy();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<HttpErrorInfo | null>(null);

  const checks = useMemo(() => checkCredentials(policy, { username, email, password }), [policy, username, email, password]);
  const ready = allChecksPass(policy, checks);
  const errorField = error === null ? null : fieldOf(error.code);
  const fieldError = (field: Field) => (error !== null && errorField === field ? httpErrorMessage(t, error) : null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !ready) return;
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
        <h1 className="font-display text-22 font-bold tracking-[0.02em]">{t('auth.registerTitle')}</h1>
        <p className="text-14 text-muted">{t('auth.registerLead')}</p>
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

      <section aria-labelledby="requirements-title" className="flex flex-col gap-2 rounded-10 bg-sunken px-3.5 py-3 shadow-ring-quiet">
        <h2 id="requirements-title" className="text-12 font-extrabold tracking-label text-muted uppercase">
          {t('auth.requirements')}
        </h2>
        <ul className="flex flex-col gap-1">
          {requiredChecks(policy).map((check) => (
            <li key={check} data-check={check} data-met={checks[check]} className="flex items-center gap-2 text-14">
              <RequirementIcon met={checks[check]} />
              <span className={checks[check] ? 'text-primary' : 'text-muted'}>{t(`auth.checks.${check}`, checkParams(check, policy))}</span>
              <span className="sr-only">{checks[check] ? t('auth.requirementMet') : t('auth.requirementUnmet')}</span>
            </li>
          ))}
        </ul>
      </section>

      {error !== null && errorField === null && (
        <p role="alert" className="text-14 text-danger">
          {httpErrorMessage(t, error)}
        </p>
      )}

      <Button type="submit" size="lg" fullWidth disabled={submitting || !ready}>
        {submitting ? t('auth.submitting') : t('auth.submitRegister')}
      </Button>

      <Link to="/login" className="inline-flex min-h-[var(--hit-target)] items-center text-14 font-semibold text-accent hover:text-accent-hover">
        {t('auth.toLogin')}
      </Link>
    </form>
  );
}
