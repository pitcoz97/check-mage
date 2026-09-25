import { useTranslation } from 'react-i18next';

import { changeLanguage, currentLanguage, isLanguage, LANGUAGES } from './index';

/** Selettore di lingua: italiano di default, inglese secondario. La scelta persiste tramite storage. */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const selected = currentLanguage();
  return (
    <label className="flex items-center gap-2 text-14 text-muted">
      <span className="sr-only">{t('language.label')}</span>
      <select
        aria-label={t('language.label')}
        className="min-h-[var(--hit-target)] rounded-10 bg-sunken px-2 text-14 text-primary shadow-ring-quiet"
        value={selected}
        onChange={(event) => {
          const value = event.target.value;
          if (isLanguage(value)) void changeLanguage(value);
        }}
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`language.${language}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
