import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { LegalDocKey } from './types';

/** Percorso pubblico di ogni documento legale (P4). */
export const LEGAL_PATHS: Readonly<Record<LegalDocKey, string>> = {
  privacy: '/privacy',
  terms: '/terms',
  accountDeletion: '/account-deletion',
  credits: '/credits',
};

/**
 * Collegamenti ai documenti legali: sotto login e registrazione, nelle Impostazioni e in fondo a ogni documento.
 * `newTab`: si aprono in un'altra scheda, per non perdere un modulo a metà (registrazione).
 */
export function LegalLinks({ exclude = [], newTab = false }: { exclude?: readonly LegalDocKey[]; newTab?: boolean }) {
  const { t } = useTranslation();
  const keys = (Object.keys(LEGAL_PATHS) as LegalDocKey[]).filter((key) => !exclude.includes(key));
  return (
    <ul data-legal-links className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-13">
      {keys.map((key) => (
        <li key={key}>
          {newTab ? (
            <Link
              to={LEGAL_PATHS[key]}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[var(--hit-target)] items-center font-semibold text-muted hover:text-primary"
            >
              {t(`legal.docs.${key}`)}
            </Link>
          ) : (
            <Link to={LEGAL_PATHS[key]} className="inline-flex min-h-[var(--hit-target)] items-center font-semibold text-muted hover:text-primary">
              {t(`legal.docs.${key}`)}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
