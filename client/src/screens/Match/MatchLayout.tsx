import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface MatchLayoutSlots {
  readonly opponent: ReactNode;
  readonly board: ReactNode;
  readonly phases: ReactNode;
  readonly history: ReactNode;
  readonly actions: ReactNode;
  readonly self: ReactNode;
  readonly hand: ReactNode;
  /** Avvisi a tutta larghezza sopra la partita (stato della connessione). */
  readonly banner?: ReactNode;
}

/**
 * Scheletro della schermata di gioco (briefing §7.3, §7.4). Solo disposizione: il contenuto arriva dagli Step 4–5.
 *
 * - Desktop (≥ lg): avversario sopra, scacchiera il più grande possibile a sinistra, colonna laterale con fasi,
 *   storico e azioni, pannello proprio e mano sotto.
 * - Mobile portrait: avversario, barra fasi sottile, scacchiera a tutta larghezza, pannello proprio, mano
 *   ancorata al bordo inferiore, storico dietro un pannello a scomparsa.
 */
export function MatchLayout(slots: MatchLayoutSlots) {
  const { t } = useTranslation();
  return (
    <div className="safe-area flex min-h-full flex-col">
      {slots.banner}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-2 p-2 lg:grid lg:grid-cols-[minmax(0,1fr)_var(--side-column)] lg:grid-rows-[auto_minmax(0,1fr)_auto_auto] lg:gap-3 lg:p-4">
        <div data-region="opponent" className="lg:col-start-1 lg:row-start-1">
          {slots.opponent}
        </div>

        <div data-region="phases-mobile" className="lg:hidden">
          {slots.phases}
        </div>

        <div data-region="board" className="flex min-h-0 items-center justify-center lg:col-start-1 lg:row-start-2">
          <div className="aspect-square w-[min(100%,calc(100dvh-14rem))]">{slots.board}</div>
        </div>

        <aside
          data-region="side"
          className="hidden lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:gap-3"
        >
          {slots.phases}
          <div className="min-h-0 flex-1">{slots.history}</div>
          {slots.actions}
        </aside>

        <div data-region="self" className="flex flex-col gap-2 lg:col-start-1 lg:row-start-3">
          {slots.self}
          <details className="lg:hidden">
            <summary className="flex min-h-[var(--hit-target)] cursor-pointer items-center text-14 font-semibold text-muted">
              {t('match.showHistory')}
            </summary>
            {slots.history}
          </details>
          <div className="lg:hidden">{slots.actions}</div>
        </div>

        <div data-region="hand" className="sticky-bottom-safe lg:static lg:col-start-1 lg:row-start-4">
          {slots.hand}
        </div>
      </div>
    </div>
  );
}
