import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { Panel } from '../design/components/Panel';
import { LanguageSwitch } from '../i18n/LanguageSwitch';

/** Layout di login e registrazione: una card centrata, niente distrazioni (briefing §7.1). */
export function AuthLayout() {
  const { t } = useTranslation();
  return (
    <div className="safe-area flex min-h-full flex-col items-center justify-center gap-6 px-4 py-8">
      <div className="text-center">
        <p className="text-28 font-bold">{t('app.name')}</p>
        <p className="text-14 text-muted">{t('app.tagline')}</p>
      </div>
      <Panel className="w-full max-w-sm p-6">
        <Outlet />
      </Panel>
      <div className="w-full max-w-sm">
        <LanguageSwitch showLabel={false} />
      </div>
    </div>
  );
}
