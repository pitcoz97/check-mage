import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';

import { LanguageSwitch } from '../i18n/LanguageSwitch';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'inline-flex min-h-[var(--hit-target)] items-center rounded-md px-3 text-sm font-semibold',
    isActive ? 'bg-elevated text-primary' : 'text-muted hover:text-primary',
  ].join(' ');

/** Shell delle schermate fuori partita: barra in alto silenziosa, contenuto al centro. */
export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="safe-area flex min-h-full flex-col">
      <header className="border-b border-subtle bg-panel">
        <div className="mx-auto flex min-h-[var(--header-height)] max-w-5xl flex-wrap items-center gap-2 px-4">
          <Link to="/lobby" className="mr-auto text-lg font-bold text-primary">
            {t('app.name')}
          </Link>
          <nav aria-label={t('nav.main')} className="flex items-center gap-1">
            <NavLink to="/lobby" className={navLinkClass}>
              {t('nav.lobby')}
            </NavLink>
            <NavLink to="/profile" className={navLinkClass}>
              {t('nav.profile')}
            </NavLink>
          </nav>
          <LanguageSwitch />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
