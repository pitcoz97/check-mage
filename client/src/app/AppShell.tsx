import { useEffect, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router';

import { useMatch } from '../store/MatchProvider';
import { MobileHeader, MobileTabBar, SideNav } from './Navigation';

/**
 * Shell delle schermate fuori partita (tavole "Home"): barra laterale da 220px su desktop, intestazione e barra
 * inferiore su Android.
 *
 * Una partita in corso resta in background mentre si naviga (D13): la sessione vive a livello d'app. Si entra in
 * partita da soli solo quando la coda trova un avversario, ovunque ci si trovi nella shell.
 */
export function AppShell() {
  const navigate = useNavigate();
  const lifecycle = useMatch((s) => s.lifecycle);
  const previous = useRef(lifecycle);

  useEffect(() => {
    if (previous.current === 'queued' && lifecycle === 'playing') void navigate('/match');
    previous.current = lifecycle;
  }, [lifecycle, navigate]);

  return (
    <div className="flex min-h-dvh">
      <div className="hidden lg:block">
        <SideNav />
      </div>
      <div className="flex min-w-0 grow flex-col px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] lg:px-10 lg:pt-8 lg:pb-8">
        <div className="lg:hidden">
          <MobileHeader />
        </div>
        <main className="flex grow flex-col pt-4 lg:pt-0">
          <Outlet />
        </main>
      </div>
      <div className="lg:hidden">
        <MobileTabBar />
      </div>
    </div>
  );
}
