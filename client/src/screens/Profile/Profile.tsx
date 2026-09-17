import { useTranslation } from 'react-i18next';

import { Panel } from '../../design/components/Panel';

/** Segnaposto: profilo con ELO e statistiche allo Step 2. */
export function Profile() {
  const { t } = useTranslation();
  return (
    <Panel className="p-6">
      <h1 className="text-xl font-bold">{t('profile.title')}</h1>
      <p className="text-muted">{t('profile.lead')}</p>
    </Panel>
  );
}
