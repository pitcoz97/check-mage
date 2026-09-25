import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { changeLanguage, currentLanguage, LANGUAGES } from './index';

/**
 * Selettore di lingua a due pulsanti, come nella barra laterale della tavola "Home · desktop". Sta nelle Impostazioni
 * e nel login (D15); italiano di default, la scelta persiste tramite storage.
 */
export function LanguageSwitch({ showLabel = true }: { showLabel?: boolean }) {
  const { t } = useTranslation();
  const labelId = useId();
  const selected = currentLanguage();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className={showLabel ? 'text-12 font-bold tracking-[0.08em] text-muted uppercase' : 'sr-only'}>
        {t('language.label')}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex gap-1 rounded-10 bg-sunken p-1 shadow-ring-quiet">
        {LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            aria-pressed={selected === language}
            onClick={() => void changeLanguage(language)}
            className={`h-9 min-w-24 grow basis-0 rounded-7 px-3 text-14 font-bold ${selected === language ? 'bg-elevated text-primary' : 'text-muted hover:text-primary'}`}
          >
            {t(`language.${language}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
