import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/** Segnaposto: il modulo di login (email + password) arriva allo Step 2. */
export function Login() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-bold">{t('auth.loginTitle')}</h1>
      <p className="text-sm text-muted">{t('auth.loginLead')}</p>
      <p className="text-sm text-muted">{t('auth.comingSoon')}</p>
      <Link to="/register" className="inline-flex min-h-[var(--hit-target)] items-center text-sm font-semibold text-accent hover:text-accent-hover">
        {t('auth.toRegister')}
      </Link>
    </div>
  );
}
