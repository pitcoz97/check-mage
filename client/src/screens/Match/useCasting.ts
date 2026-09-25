import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardTargeting } from '../../game/board/Board';
import type { HandCard, PieceKind, SquareEffects } from '../../game/model';
import {
  beginTargeting,
  pickChoice,
  pickTarget,
  targetingCandidates,
  targetingPrompt,
  TARGETING_IDLE,
  type TargetingOutcome,
  type TargetingState,
} from '../../game/targeting';
import type { Spell } from '../../spells/schema';
import { spellName } from '../../spells/texts';
import { useMatch, useMatchSession } from '../../store/MatchProvider';
import { refusalMessage } from './errorMessage';

/**
 * Lancio di una magia, dalla carta al `cast_spell`: tiene la macchina di targeting e la collega alla scacchiera.
 *
 * Nessun ottimismo (briefing §8): mano, mana e fase cambiano solo quando lo dice il server. Qui si segna solo che
 * un cast è partito, per non mandarlo due volte.
 */

export interface Casting {
  /** Carta in corso di bersaglio. */
  readonly selectedInstanceId: string | null;
  readonly spellName: string | null;
  readonly spellCost: number | null;
  /** Istruzione del passo corrente ("Scegli un pezzo avversario"). */
  readonly prompt: string | null;
  readonly boardTargeting: BoardTargeting | null;
  /** Scelta del pezzo dopo i bersagli (promozione, ritorno dal cimitero), o `null`. */
  readonly choice: { readonly options: readonly PieceKind[]; choose(piece: PieceKind): void; cancel(): void } | null;
  /** Avvia il lancio: senza bersagli parte subito. */
  pick(card: HandCard, spell: Spell): void;
  cancel(): void;
}

const NO_EFFECTS: readonly SquareEffects[] = [];
const NO_PIECES: readonly PieceKind[] = [];

export function useCasting(notify: (message: string) => void): Casting {
  const { t } = useTranslation();
  const session = useMatchSession();
  const beginCast = useMatch((s) => s.beginCast);
  const fen = useMatch((s) => s.game?.fen ?? '');
  const phase = useMatch((s) => s.game?.phase ?? 'unknown');
  const myColor = useMatch((s) => s.myColor);
  const effects = useMatch((s) => s.game?.activeEffects ?? NO_EFFECTS);
  const squareStates = useMatch((s) => s.game?.squareStates ?? NO_EFFECTS);
  const graveyard = useMatch((s) => (s.myColor === null ? NO_PIECES : (s.game?.graveyards[s.myColor] ?? NO_PIECES)));
  const [state, setState] = useState<TargetingState>(TARGETING_IDLE);

  // Una posizione o una fase nuova rendono vecchi i bersagli scelti: si annulla durante il render, senza effetti.
  const signature = `${fen}|${phase}`;
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    if (state.kind !== 'idle') setState(TARGETING_IDLE);
  }

  // Esc annulla, come il tap fuori dai bersagli e il bottone (briefing §7.5).
  useEffect(() => {
    if (state.kind === 'idle') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setState(TARGETING_IDLE);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state.kind]);

  const ctx = { fen, myColor: myColor ?? 'white', effects, squareStates, graveyard } as const;

  function apply(outcome: TargetingOutcome): void {
    if (outcome.kind === 'state') {
      setState(outcome.state);
      return;
    }
    if (outcome.kind === 'refused') {
      notify(t(`spells.refusal.${outcome.reason}`));
      if (outcome.reason === 'unsupported_target') setState(TARGETING_IDLE);
      return;
    }
    const sent = session.send({ type: 'cast_spell', card: outcome.card, targets: outcome.targets, choice: outcome.choice });
    if (sent) beginCast(outcome.card.spellId);
    else notify(refusalMessage(t, 'not_connected'));
    setState(TARGETING_IDLE);
  }

  return {
    selectedInstanceId: state.kind === 'idle' ? null : state.card.instanceId,
    spellName: state.kind === 'idle' ? null : spellName(t, state.spell, state.spell.id),
    spellCost: state.kind === 'idle' ? null : state.spell.manaCost,
    prompt: targetingPrompt(state, t),
    boardTargeting:
      state.kind !== 'collecting'
        ? null
        : {
            squares: new Set(targetingCandidates(state, ctx)),
            onPick: (square) => apply(pickTarget(state, ctx, square)),
            onCancel: () => setState(TARGETING_IDLE),
          },
    choice:
      state.kind !== 'choosing'
        ? null
        : { options: state.options, choose: (piece) => apply(pickChoice(state, piece)), cancel: () => setState(TARGETING_IDLE) },
    pick: (card, spell) => apply(beginTargeting(card, spell, ctx)),
    cancel: () => setState(TARGETING_IDLE),
  };
}
