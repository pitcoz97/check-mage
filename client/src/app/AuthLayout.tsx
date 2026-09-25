import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { LogoMark } from '../design/components/AppIcon';
import { Panel } from '../design/components/Panel';
import { LanguageSwitch } from '../i18n/LanguageSwitch';

/**
 * Layout di login e registrazione (briefing §7.1): una card centrata, niente distrazioni. Non è nelle tavole: prende
 * l'intestazione della "Direzione visiva" (marchio oro e nome in Cinzel) e il pannello della home (D20).
 */
export function AuthLayout() {
  const { t } = useTranslation();
  return (
    <div className="safe-area flex min-h-full flex-col items-center justify-center gap-6 px-4 py-8">
      <div className="flex items-center gap-3.5">
        <LogoMark size="lg" />
        <div className="flex flex-col gap-0.5">
          <p className="font-display text-28 leading-none font-extrabold tracking-[0.03em]">{t('app.name')}</p>
          <p className="text-14 text-muted">{t('app.tagline')}</p>
        </div>
      </div>
      <Panel className="w-full max-w-sm rounded-16 p-6 lg:p-7">
        <Outlet />
      </Panel>
      <div className="w-full max-w-sm">
        <LanguageSwitch showLabel={false} />
      </div>
    </div>
  );
}
