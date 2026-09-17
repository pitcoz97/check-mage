import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/** Segnaposto: il modulo di registrazione (username, email, password) arriva allo Step 2. */
export function Register() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-bold">{t('auth.registerTitle')}</h1>
      <p className="text-sm text-muted">{t('auth.registerLead')}</p>
      <p className="text-sm text-muted">{t('auth.comingSoon')}</p>
      <Link to="/login" className="inline-flex min-h-[var(--hit-target)] items-center text-sm font-semibold text-accent hover:text-accent-hover">
        {t('auth.toLogin')}
      </Link>
    </div>
  );
}
