import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Board } from '../../game/board/Board';
import { PromotionDialog } from '../../game/board/PromotionDialog';
import type { BoardContext, PickupRefusal } from '../../game/board/selection';
import type { Color, Square } from '../../game/model';
import { toUci } from '../../game/position';
import { useMatch, useMatchSession, useSessionStatus } from '../../store/MatchProvider';
import { refusalMessage } from './errorMessage';

/** Caselle con un pezzo congelato, dallo stato del server: il pickup si blocca prima di disturbare il server. */
function frozenSquares(effects: readonly { square: Square; effects: readonly { kind: string }[] }[]): Set<Square> {
  return new Set(effects.filter((entry) => entry.effects.some((effect) => effect.kind === 'freeze')).map((entry) => entry.square));
}

/** Scacchiera collegata alla partita: legge lo stato, manda gli intenti, mostra l'anteprima della propria mossa. */
export function MatchBoard({ onRefused }: { onRefused(message: string): void }) {
  const { t } = useTranslation();
  const session = useMatchSession();
  const game = useMatch((s) => s.game);
  const myColor = useMatch((s) => s.myColor);
  const optimistic = useMatch((s) => s.optimistic);
  const playing = useMatch((s) => s.lifecycle === 'playing');
  const previewMove = useMatch((s) => s.previewMove);
  const connected = useSessionStatus((s) => s.connection.kind === 'open');
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);

  if (game === null) return null;

  const context: BoardContext = {
    fen: game.fen,
    myColor,
    activePlayer: game.activePlayer,
    phase: game.phase,
    frozen: frozenSquares(game.activeEffects),
    canAct: playing && connected,
  };

  const lastPlayed = [...game.moves].reverse().find((move) => move.kind === 'move');
  const lastMove =
    lastPlayed === undefined ? null : { from: lastPlayed.uci.slice(0, 2) as Square, to: lastPlayed.uci.slice(2, 4) as Square };

  function sendMove(from: Square, to: Square, promotionLetter?: string): void {
    const sent = session.send({ type: 'move', move: toUci(from, to, promotionLetter) });
    // Ottimismo solo sulla propria mossa (briefing §8): se il socket non è aperto non si mostra nulla.
    if (sent) previewMove(from, to);
    else onRefused(refusalMessage(t, 'not_connected'));
  }

  return (
    <div className="relative aspect-square w-full">
      <Board
        context={context}
        orientation={myColor ?? 'white'}
        lastMove={lastMove}
        optimistic={optimistic}
        onMove={(from, to, needsPromotion) => (needsPromotion ? setPromotion({ from, to }) : sendMove(from, to))}
        onRefused={(reason: PickupRefusal) => onRefused(refusalMessage(t, reason))}
      />
      {promotion !== null && (
        <PromotionDialog
          color={(myColor ?? 'white') as Color}
          onCancel={() => setPromotion(null)}
          onChoose={(letter) => {
            sendMove(promotion.from, promotion.to, letter);
            setPromotion(null);
          }}
        />
      )}
    </div>
  );
}
