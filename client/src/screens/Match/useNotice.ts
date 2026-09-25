import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { piecesOf } from '../../game/fen';
import type { Color, PieceKind, Square } from '../../game/model';
import { useCatalog } from '../../spells/CatalogProvider';
import { effectPresentation, runeName } from '../../spells/effects.registry';
import { spellName } from '../../spells/texts';
import { useMatch } from '../../store/MatchProvider';
import type { TriggeredRune } from '../../store/matchStore';
import { protocolErrorMessage } from './errorMessage';

/**
 * Avviso della partita da mostrare nel box del suggerimento (REDESIGN_PLAN.md D16): rifiuto del server, magia
 * lanciata (anche nascosta), runa scattata, esito di un'offerta di patta, o rifiuto deciso dal client (carta spenta,
 * pezzo congelato). Vince il più recente e dura `NOTICE_MS`, poi il box torna al suggerimento. Nessun effetto sullo
 * stato di gioco.
 */

export const NOTICE_MS = 5_000;

export type NoticeKind = 'cast' | 'refused' | 'draw' | 'rune';

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
  const lastRune = useMatch((s) => s.lastRune);
  const fen = useMatch((s) => s.game?.fen ?? null);
  const myColor = useMatch((s) => s.myColor);
  const byId = useCatalog((s) => s.byId);
  const [local, setLocal] = useState<Candidate | null>(null);
  const [localCount, setLocalCount] = useState(0);
  /** Chiave dell'ultimo avviso già scaduto. */
  const [expired, setExpired] = useState<string | null>(null);

  const candidates: Candidate[] = [];
  if (lastError !== null) {
    candidates.push({ kind: 'refused', text: protocolErrorMessage(t, lastError.info, myColor), key: `error:${lastError.seq}`, order: lastError.seq });
  }
  if (lastCast !== null) {
    const { spellId } = lastCast;
    candidates.push({
      kind: 'cast',
      text:
        spellId === null
          ? t('spells.hiddenCastByOpponent')
          : t(lastCast.player === myColor ? 'spells.castByYou' : 'spells.castByOpponent', {
              name: spellName(t, byId.get(spellId), spellId),
              effects: lastCast.effects.map((effect) => effectPresentation(effect.kind).label(t)).join(', '),
            }),
      key: `cast:${lastCast.seq}`,
      order: lastCast.seq,
    });
  }
  if (lastRune !== null) {
    candidates.push({ kind: 'rune', text: runeNotice(t, lastRune, fen, myColor), key: `rune:${lastRune.seq}`, order: lastRune.seq });
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

/**
 * "La Runa di stasi in e5 ha congelato il tuo cavallo." Il pezzo è di chi ha mosso, cioè dell'avversario di chi ha
 * piazzato la runa; il tipo si legge dal `game_state` arrivato subito prima (solo per il testo), o dal risultato.
 */
function runeNotice(t: TFunction, rune: TriggeredRune, fen: string | null, myColor: Color | null): string {
  const { result } = rune;
  const at = (square: Square): PieceKind | 'unknown' => (fen === null ? 'unknown' : (piecesOf(fen).find((p) => p.square === square)?.kind ?? 'unknown'));
  let kind: PieceKind | 'unknown' = 'unknown';
  if (result.kind === 'freeze_piece') kind = at(result.target);
  else if (result.kind === 'return_to_origin') kind = at(result.to);
  else if (result.kind === 'destroy_piece') kind = result.destroyedPiece;
  const whose = myColor !== null && rune.owner === myColor ? 'theirs' : 'mine';
  const params = { rune: runeName(t, rune.onEnter), square: rune.square, piece: t(`spells.runeTriggered.${whose}.${kind}`) };
  if (result.kind === 'return_to_origin') return t('spells.runeTriggered.return_to_origin', { ...params, to: result.to });
  return t(`spells.runeTriggered.${result.kind}`, params);
}
