import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCatalog } from '../../spells/CatalogProvider';
import { effectPresentation } from '../../spells/effects.registry';
import { useMatch } from '../../store/MatchProvider';
import { protocolErrorMessage } from './errorMessage';

/**
 * Avviso della partita da mostrare nel box del suggerimento (REDESIGN_PLAN.md D16): rifiuto del server, magia
 * lanciata, esito di un'offerta di patta, o rifiuto deciso dal client (carta spenta, pezzo congelato). Vince il più
 * recente e dura `NOTICE_MS`, poi il box torna al suggerimento. Nessun effetto sullo stato di gioco.
 */

export const NOTICE_MS = 5_000;

export type NoticeKind = 'cast' | 'refused' | 'draw';

export interface Notice {
  readonly kind: NoticeKind;
  readonly text: string;
  /** Identità dell'avviso: due avvisi uguali e consecutivi restano distinti. */
  readonly key: string;
}

interface Candidate extends Notice {
  readonly order: number;
}

export function useNotice(): { notice: Notice | null; show(text: string): void; dismiss(): void } {
  const { t } = useTranslation();
  const seq = useMatch((s) => s.seq);
  const lastError = useMatch((s) => s.lastError);
  const drawNotice = useMatch((s) => s.drawNotice);
  const lastCast = useMatch((s) => s.lastCast);
  const myColor = useMatch((s) => s.myColor);
  const byId = useCatalog((s) => s.byId);
  const [local, setLocal] = useState<Candidate | null>(null);
  const [localCount, setLocalCount] = useState(0);
  /** Chiave dell'ultimo avviso già scaduto. */
  const [expired, setExpired] = useState<string | null>(null);

  const candidates: Candidate[] = [];
  if (lastError !== null) {
    candidates.push({ kind: 'refused', text: protocolErrorMessage(t, lastError.info), key: `error:${lastError.seq}`, order: lastError.seq });
  }
  if (lastCast !== null) {
    candidates.push({
      kind: 'cast',
      text: t(lastCast.player === myColor ? 'spells.castByYou' : 'spells.castByOpponent', {
        name: byId.get(lastCast.spellId)?.name ?? lastCast.spellId,
        effects: lastCast.effects.map((effect) => effectPresentation(effect.kind).label(t)).join(', '),
      }),
      key: `cast:${lastCast.seq}`,
      order: lastCast.seq,
    });
  }
  if (drawNotice !== null) {
    candidates.push({
      kind: 'draw',
      text: t(drawNotice.reason === 'move_played' ? 'match.notice.drawLapsed' : 'match.notice.drawDeclined'),
      key: `draw:${drawNotice.seq}`,
      order: drawNotice.seq,
    });
  }
  if (local !== null) candidates.push(local);
  const latest = candidates.sort((a, b) => a.order - b.order).at(-1) ?? null;
  const current = latest !== null && latest.key !== expired ? latest : null;
  const currentKey = current?.key ?? null;

  useEffect(() => {
    if (currentKey === null) return;
    const timer = setTimeout(() => setExpired(currentKey), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [currentKey]);

  return {
    notice: current === null ? null : { kind: current.kind, text: current.text, key: current.key },
    show: (text: string) => {
      // Mezzo punto sopra il progressivo corrente: più recente di tutto ciò che è già arrivato dal server.
      setLocal({ kind: 'refused', text, key: `local:${localCount}`, order: seq + 0.5 });
      setLocalCount(localCount + 1);
    },
    /** L'avviso corrente lascia il posto: per esempio quando si sceglie una carta da lanciare. */
    dismiss: () => {
      if (currentKey !== null) setExpired(currentKey);
    },
  };
}
