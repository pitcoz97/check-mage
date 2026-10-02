import { useTranslation } from 'react-i18next';

import { BACKUP_RETENTION_DAYS, LEGAL_CONFIG, MINIMUM_AGE, type LegalConfig } from './config';
import { englishTexts } from './texts.en';
import { italianTexts } from './texts.it';
import type { LegalTexts } from './types';

/** I testi legali nella lingua indicata, con i valori della configurazione (P4). L'italiano è la versione di riferimento. */
export function legalTexts(language: string, config: LegalConfig = LEGAL_CONFIG): LegalTexts {
  const english = language.startsWith('en');
  const date = new Date(`${config.effectiveDate}T12:00:00Z`);
  const effectiveDate = Number.isNaN(date.getTime())
    ? config.effectiveDate
    : date.toLocaleDateString(english ? 'en-GB' : 'it-IT', { dateStyle: 'long', timeZone: 'UTC' });
  const context = {
    owner: config.owner,
    email: config.contactEmail,
    hosting: config.hosting,
    effectiveDate,
    minimumAge: MINIMUM_AGE,
    backupDays: BACKUP_RETENTION_DAYS,
  };
  return english ? englishTexts(context) : italianTexts(context);
}

/** I testi legali nella lingua dell'app. */
export function useLegalTexts(): LegalTexts {
  const { i18n } = useTranslation();
  return legalTexts(i18n.language);
}
