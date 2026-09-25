import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

function ErrorPage({ title, lead }: { title: string; lead: string }) {
  const { t } = useTranslation();
  return (
    <div className="safe-area flex min-h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-28 font-bold">{title}</h1>
      <p className="text-muted">{lead}</p>
      <Link to="/lobby" className="inline-flex min-h-[var(--hit-target)] items-center font-semibold text-accent hover:text-accent-hover">
        {t('errors.backToLobby')}
      </Link>
    </div>
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
