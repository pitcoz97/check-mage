import type { ReactNode } from 'react';

import { LogoMark } from '../design/components/AppIcon';

/**
 * Pagina di stato centrata (verifica della sessione, server irraggiungibile, 404, attesa della partita). Non è nelle
 * tavole: marchio oro, titolo in Cinzel, testo spento, un'azione (D20).
 */
export function StatePage({ title, lead, children }: { title?: string; lead?: string; children?: ReactNode }) {
  return (
    <div className="safe-area flex min-h-full flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <LogoMark size="lg" />
      {title !== undefined && <h1 className="font-display text-28 font-bold tracking-[0.02em]">{title}</h1>}
      {lead !== undefined && <p className="max-w-sm text-15 text-muted">{lead}</p>}
      {children}
    </div>
  );
}
