import type { CSSProperties, ReactNode } from 'react';

export interface MatchLayoutSlots {
  /** Desktop: la barra verticale da 72px della tavola. */
  readonly nav: ReactNode;
  /** Avvisi di connessione, sopra tutto. */
  readonly banner?: ReactNode;
  readonly opponent: ReactNode;
  readonly board: ReactNode;
  readonly self: ReactNode;
  /** La mano; a partita finita il riepilogo al suo posto (Android). */
  readonly hand: ReactNode;
  /** Colonna laterale desktop: pannello del turno, mana, schede, azioni. */
  readonly turn: ReactNode;
  readonly mana: ReactNode;
  readonly tabs: ReactNode;
  readonly actions: ReactNode;
  /** Android: fasi con la CTA compatta, riga del suggerimento, barra inferiore. */
  readonly phasesCompact: ReactNode;
  readonly hintLine: ReactNode;
  readonly bottomBar: ReactNode;
}

/**
 * Disposizione della partita (REDESIGN_PLAN.md §3.4), dalle tavole:
 *
 * - **Desktop (≥ 1024px), "Partita · desktop":** schermo intero senza scorrimento. Colonna della scacchiera (riga
 *   avversario, scacchiera fino a 560px, riga propria, 8px fra loro), centrata fra la barra da 72px e la
 *   colonna laterale di 380px (12px fra i blocchi, 20px dal bordo destro). La mano sta sotto la scacchiera,
 *   centrata su di essa, e sborda di 20px dal bordo inferiore.
 * - **Android, "Partita · Android":** riga avversario, scacchiera a tutta larghezza, riga propria, fasi con la CTA,
 *   suggerimento, mano ancorata in basso (10px sotto la barra), barra inferiore da 64px.
 *
 * La scacchiera è la variabile `--board`: tutta la larghezza su Android, fino a 560px su desktop, e si stringe se
 * l'altezza non basta (i numeri sono le altezze fisse delle tavole attorno alla scacchiera). Come nelle tavole, lo
 * schermo non scorre: le carte esterne del ventaglio sono tagliate dal bordo.
 */
const BOARD_SIZE = {
  '--board-mobile': 'max(240px, min(100vw, calc(100dvh - 454px)))',
  '--board-desktop': 'min(560px, calc(100dvh - 340px), calc(100vw - 540px))',
} as CSSProperties;

export function MatchLayout(slots: MatchLayoutSlots) {
  return (
    <div
      style={BOARD_SIZE}
      className="relative flex h-dvh flex-col overflow-hidden px-[env(safe-area-inset-right,0px)] pt-[env(safe-area-inset-top,0px)] pl-[env(safe-area-inset-left,0px)] [--board:var(--board-mobile)] lg:flex-row lg:overflow-hidden lg:pr-5 lg:pl-0 lg:[--board:var(--board-desktop)]"
    >
      {slots.banner !== undefined && (
        <div
          data-region="banner"
          className="fixed inset-x-0 top-[env(safe-area-inset-top,0px)] z-50 flex justify-center"
        >
          {slots.banner}
        </div>
      )}

      <div data-region="nav" className="hidden lg:block">
        {slots.nav}
      </div>

      {/* Su desktop la colonna della scacchiera sta al centro dello spazio lasciato dalla colonna laterale. */}
      <div className="flex grow flex-col lg:h-full lg:flex-row lg:justify-center">
        <div
          data-region="main"
          className="relative flex grow flex-col lg:h-full lg:w-[var(--board)] lg:grow-0"
        >
          <div data-region="opponent" className="px-3 pt-4 lg:px-0 lg:pt-5">
            {slots.opponent}
          </div>
          <div data-region="board" className="mt-2.5 w-[var(--board)] self-center lg:mt-2">
            {slots.board}
          </div>
          <div data-region="self" className="mt-2.5 px-3 lg:mt-2 lg:px-0">
            {slots.self}
          </div>
          <div data-region="phases-mobile" className="mt-3 flex h-11 items-center gap-2 px-3 lg:hidden">
            {slots.phasesCompact}
          </div>
          <div data-region="hint-mobile" className="mt-2 px-4 lg:hidden">
            {slots.hintLine}
          </div>
          <div className="min-h-3.5 grow" />
          <div
            data-region="hand"
            className="relative z-30 mb-[calc(3.375rem+env(safe-area-inset-bottom,0px))] lg:absolute lg:bottom-[-20px] lg:left-1/2 lg:mb-0 lg:w-[min(760px,calc(var(--board)+200px))] lg:-translate-x-1/2"
          >
            {slots.hand}
          </div>
        </div>
      </div>

      <aside
        data-region="side"
        className="hidden lg:ml-5 lg:flex lg:h-full lg:w-[380px] lg:shrink-0 lg:flex-col lg:gap-3 lg:py-5"
      >
        {slots.turn}
        {slots.mana}
        <div className="flex min-h-0 grow flex-col">{slots.tabs}</div>
        {slots.actions}
      </aside>

      {slots.bottomBar}
    </div>
  );
}
