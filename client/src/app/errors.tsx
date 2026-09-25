import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { StatePage } from './StatePage';

function ErrorPage({ title, lead }: { title: string; lead: string }) {
  const { t } = useTranslation();
  return (
    <StatePage title={title} lead={lead}>
      <Link to="/lobby" className="inline-flex min-h-[var(--hit-target)] items-center font-bold text-accent hover:text-accent-hover">
        {t('errors.backToLobby')}
      </Link>
    </StatePage>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return <ErrorPage title={t('errors.notFoundTitle')} lead={t('errors.notFoundLead')} />;
}

/** Errore imprevisto in una rotta: messaggio generico, mai il testo tecnico dell'eccezione. */
export function RouteError() {
  const { t } = useTranslation();
  return <ErrorPage title={t('errors.genericTitle')} lead={t('errors.genericLead')} />;
}
