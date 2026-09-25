import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router';

import { AppIcon, LogoMark } from '../design/components/AppIcon';
import { useAuth } from '../store/AuthProvider';
import { NAV_ITEMS, type NavItem } from './nav';

/**
 * Le barre di navigazione delle tavole: laterale da 220px (home desktop), verticale da 72px (partita desktop),
 * intestazione e barra inferiore da 76px (Android). Stesse voci ovunque (`nav.ts`); quelle «Presto» si vedono ma non
 * portano da nessuna parte (D9). La lingua non sta qui ma nelle Impostazioni (D15).
 */

function useAccount() {
  const username = useAuth((s) => s.account?.username ?? '');
  const elo = useAuth((s) => s.account?.elo ?? null);
  return { username, elo, initial: username.slice(0, 1).toUpperCase() };
}

function SoonPill() {
  const { t } = useTranslation();
  return <span className="rounded-pill bg-quiet px-1.5 py-px text-11 font-bold text-muted">{t('nav.soon')}</span>;
}

/** Barra laterale della home desktop. */
export function SideNav() {
  const { t } = useTranslation();
  const account = useAccount();
  return (
    <nav aria-label={t('nav.main')} className="sticky top-0 flex h-dvh w-[220px] shrink-0 flex-col gap-1 border-r border-nav-border bg-nav px-3.5 py-6">
      <Link to="/lobby" className="mb-6 flex items-center gap-3 px-1.5 text-primary">
        <LogoMark size="md" />
        <span className="font-display text-[21px] font-extrabold tracking-[0.02em]">{t('app.name')}</span>
      </Link>
      {NAV_ITEMS.map((item) => (
        <SideNavItem key={item.key} item={item} />
      ))}
      <span className="grow" />
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          `flex h-11 items-center gap-3.5 rounded-10 px-3.5 text-15 font-semibold ${isActive ? 'bg-panel text-primary' : 'text-muted hover:text-primary'}`
        }
      >
        <AppIcon name="settings" className="size-5" />
        {t('nav.settings')}
      </NavLink>
      <Link to="/profile" className="mt-1.5 flex items-center gap-3 rounded-12 bg-sunken p-2.5 text-primary">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-8 bg-play text-16 font-extrabold text-on-play">
          {account.initial}
        </span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-15 font-bold">{account.username}</span>
          {account.elo !== null && <span className="text-13 text-muted">{t('nav.rating', { elo: account.elo })}</span>}
        </span>
      </Link>
    </nav>
  );
}

function SideNavItem({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const label = t(`nav.${item.key}`);
  if (item.to === null) {
    return (
      <span aria-disabled="true" data-nav={item.key} className="flex h-12 cursor-not-allowed items-center gap-3.5 rounded-10 px-3.5 text-16 font-semibold text-muted">
        <AppIcon name={item.icon} className="size-[22px]" />
        <span className="grow">{label}</span>
        <SoonPill />
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      data-nav={item.key}
      className={({ isActive }) =>
        `flex h-12 items-center gap-3.5 rounded-10 px-3.5 text-16 ${isActive ? 'bg-panel font-bold text-primary [&_svg]:text-gold' : 'font-semibold text-tertiary hover:text-primary'}`
      }
    >
      <AppIcon name={item.icon} className="size-[22px]" />
      {label}
    </NavLink>
  );
}

/** Barra verticale della partita desktop: le stesse voci a icona, con l'etichetta sotto. */
export function MatchRail() {
  const { t } = useTranslation();
  const account = useAccount();
  return (
    <nav aria-label={t('nav.main')} className="flex h-dvh w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-nav-border bg-nav py-4">
      <Link to="/lobby" aria-label={t('nav.home')} className="mb-3.5">
        <LogoMark size="lg" />
      </Link>
      {NAV_ITEMS.map((item) => {
        const content = (
          <>
            <AppIcon name={item.icon} className="size-[22px]" />
            <span className="text-11 font-semibold">{t(`nav.${item.key}`)}</span>
          </>
        );
        return item.to === null ? (
          <span
            key={item.key}
            aria-disabled="true"
            data-nav={item.key}
            title={t('nav.soon')}
            className="flex h-[58px] w-[60px] cursor-not-allowed flex-col items-center justify-center gap-1 rounded-10 text-muted opacity-60"
          >
            {content}
            <span className="sr-only">{t('nav.soon')}</span>
          </span>
        ) : (
          <NavLink
            key={item.key}
            to={item.to}
            data-nav={item.key}
            className={({ isActive }) =>
              `flex h-[58px] w-[60px] flex-col items-center justify-center gap-1 rounded-10 ${isActive ? 'bg-panel text-primary' : 'text-muted hover:text-primary'}`
            }
          >
            {content}
          </NavLink>
        );
      })}
      <span className="grow" />
      <Link to="/settings" aria-label={t('nav.settings')} className="flex size-11 items-center justify-center rounded-10 text-muted hover:text-primary">
        <AppIcon name="settings" className="size-[22px]" />
      </Link>
      <Link
        to="/profile"
        aria-label={t('nav.profile')}
        className="flex size-10 items-center justify-center rounded-8 bg-play text-16 font-extrabold text-on-play"
      >
        {account.initial}
      </Link>
    </nav>
  );
}

/** Intestazione Android: marchio, Impostazioni (al posto del selettore di lingua della tavola, D15) e profilo. */
export function MobileHeader() {
  const { t } = useTranslation();
  const account = useAccount();
  return (
    <header className="flex h-11 items-center gap-2.5">
      <Link to="/lobby" className="flex items-center gap-2.5 text-primary">
        <LogoMark size="sm" />
        <span className="font-display text-[19px] font-extrabold">{t('app.name')}</span>
      </Link>
      <span className="grow" />
      <Link to="/settings" aria-label={t('nav.settings')} className="flex size-11 items-center justify-center rounded-10 bg-sunken text-muted shadow-ring-quiet">
        <AppIcon name="settings" className="size-5" />
      </Link>
      <Link
        to="/profile"
        aria-label={t('nav.profile')}
        className="flex size-10 items-center justify-center rounded-8 bg-play text-16 font-extrabold text-on-play"
      >
        {account.initial}
      </Link>
    </header>
  );
}

/** Barra inferiore Android della home (76px): la voce attiva in oro chiaro. */
export function MobileTabBar() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.main')}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4.75rem+env(safe-area-inset-bottom,0px))] justify-around border-t border-nav-border bg-nav px-1.5 pt-1.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
    >
      {NAV_ITEMS.map((item) => {
        const content = (
          <>
            <AppIcon name={item.icon} className="size-6" />
            <span className="text-11">{t(`nav.${item.key}`)}</span>
          </>
        );
        return item.to === null ? (
          <span
            key={item.key}
            aria-disabled="true"
            data-nav={item.key}
            className="flex w-[72px] cursor-not-allowed flex-col items-center justify-center gap-1 font-semibold text-muted opacity-60"
          >
            {content}
            <span className="sr-only">{t('nav.soon')}</span>
          </span>
        ) : (
          <NavLink
            key={item.key}
            to={item.to}
            data-nav={item.key}
            className={({ isActive }) =>
              `flex w-[72px] flex-col items-center justify-center gap-1 ${isActive ? 'font-extrabold text-gold-bright' : 'font-semibold text-muted'}`
            }
          >
            {content}
          </NavLink>
        );
      })}
    </nav>
  );
}
