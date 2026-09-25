import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AppIcon } from '../../design/components/AppIcon';

import { SecondaryActions } from './Actions';
import { SideTabs, type SideTab } from './SideTabs';

/**
 * Barra inferiore della partita su Android (tavola "Partita · Android") e il foglio che apre (D17). Menu, Grimorio e
 * Chat aprono lo stesso foglio sulla scheda giusta: dentro ci sono patta, resa e le schede della colonna laterale.
 * Le frecce "mossa precedente/successiva" della tavola non ci sono: il server non manda le posizioni intermedie e le
 * magie cambiano la scacchiera fuori dalle mosse (F10).
 */

const ICON = 'size-6';

function BarButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex h-12 w-14 items-center justify-center rounded-10 text-muted">
      {children}
    </button>
  );
}

export function MatchBottomBar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<SideTab | null>(null);

  return (
    <>
      <nav
        aria-label={t('match.sheet.nav')}
        className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom,0px))] items-center justify-around border-t border-nav-border bg-nav px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] lg:hidden"
      >
        <BarButton label={t('match.sheet.menu')} onClick={() => setOpen('moves')}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </BarButton>
        <BarButton label={t('match.tabs.grimoire')} onClick={() => setOpen('grimoire')}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
            <path d="M5 17a3 3 0 0 1 3-3h11" />
          </svg>
        </BarButton>
        <BarButton label={t('match.tabs.chat')} onClick={() => setOpen('chat')}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M4 5h16v11H9l-5 4z" />
          </svg>
        </BarButton>
      </nav>
      {open !== null && <MatchSheet tab={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Foglio dal basso: dialog modale, Esc e tocco fuori lo chiudono, il focus entra e poi torna alla barra. */
function MatchSheet({ tab, onClose }: { tab: SideTab; onClose(): void }) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-app/70 lg:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('match.sheet.menu')}
        data-sheet={tab}
        className="safe-area flex max-h-[80dvh] w-full flex-col gap-3 rounded-t-16 bg-app p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-18 font-bold">{t('match.sheet.menu')}</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-10 px-3 text-14 font-bold text-muted">
            {t('match.sheet.close')}
          </button>
        </div>
        <SecondaryActions />
        {/* Su Android è l'unica uscita dalla partita: che resta in corso in background (D13). */}
        <Link to="/lobby" className="flex min-h-11 items-center gap-2.5 rounded-10 bg-panel px-3.5 text-14 font-bold text-primary">
          <AppIcon name="home" className="size-5 text-gold" />
          {t('nav.home')}
        </Link>
        <SideTabs key={tab} initialTab={tab} className="min-h-64" />
      </div>
    </div>
  );
}
