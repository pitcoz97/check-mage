import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { StatePage } from '../app/StatePage';
import { Button } from '../design/components/Button';
import { InfoBox } from '../design/components/InfoBox';
import { useApi, useAuth } from '../store/AuthProvider';
import { LEGAL_PATHS } from './LegalLinks';

/**
 * Riaccettazione dei termini (P2): se Informativa o Termini sono cambiati dopo l'ultima accettazione, l'app si ferma
 * qui finché l'utente non accetta la nuova versione (o esce). Sui server che non mandano le versioni non blocca nulla.
 */
export function TermsGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const api = useApi();
  const account = useAuth((s) => s.account);
  const setAccount = useAuth((s) => s.setAccount);
  const logout = useAuth((s) => s.logout);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const outdated = account !== null && account.termsVersion !== null && account.termsCurrent !== null && account.termsVersion < account.termsCurrent;
  if (!outdated) return <>{children}</>;
  const current = account.termsCurrent ?? 0;

  async function accept() {
    setSending(true);
    setFailed(false);
    const result = await api.acceptTerms(current);
    setSending(false);
    if (result.ok) setAccount(result.value);
    else setFailed(true);
  }

  return (
    <StatePage title={t('legal.gate.title')} lead={t('legal.gate.lead')}>
      <div data-terms-gate className="flex flex-col items-center gap-4">
        <p className="flex flex-wrap justify-center gap-x-4 text-15 font-semibold">
          <Link to={LEGAL_PATHS.terms} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-hover">
            {t('legal.docs.terms')}
          </Link>
          <Link to={LEGAL_PATHS.privacy} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-hover">
            {t('legal.docs.privacy')}
          </Link>
        </p>
        {failed && (
          <InfoBox tone="danger" role="alert">
            {t('legal.gate.error')}
          </InfoBox>
        )}
        <div className="flex flex-wrap justify-center gap-2.5">
          <Button disabled={sending} onClick={() => void accept()}>
            {t('legal.gate.accept')}
          </Button>
          <Button variant="secondary" onClick={() => void logout()}>
            {t('settings.logout')}
          </Button>
        </div>
      </div>
    </StatePage>
  );
}
