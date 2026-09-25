import type { TFunction } from 'i18next';

import type { HandCard, PieceKind, Square } from './model';
import { spellChoiceOptions, type ChoiceContext } from '../spells/effects.registry';
import { spellTargets, targetPrompt, targetsSupported, type TargetContext } from '../spells/targets.registry';
import type { Spell } from '../spells/schema';

/**
 * Macchina di targeting: dalla carta scelta al `cast_spell` (briefing §7.5).
 *
 * È pura e non conosce la connessione: dice solo cosa evidenziare, cosa rifiutare e quando il cast è pronto.
 * `targets` esce nell'ordine di `spell.targets`, come lo vuole il server (una casella per bersaglio). Dopo i
 * bersagli, se un effetto lo chiede, c'è la scelta del pezzo (promozione, ritorno dal cimitero): le opzioni le dà il
 * registry degli effetti, mai un ramo per magia.
 */

export type TargetingState =
  | { readonly kind: 'idle' }
  /** Bersagli in corso di scelta: `chosen.length` è anche il passo corrente. */
  | { readonly kind: 'collecting'; readonly card: HandCard; readonly spell: Spell; readonly chosen: readonly Square[] }
  /** Bersagli scelti, manca il pezzo: la scacchiera non è cliccabile, si sceglie fra `options`. */
  | {
      readonly kind: 'choosing';
      readonly card: HandCard;
      readonly spell: Spell;
      readonly chosen: readonly Square[];
      readonly options: readonly PieceKind[];
    };

export const TARGETING_IDLE: TargetingState = { kind: 'idle' };

export type TargetingRefusal = 'unsupported_target' | 'invalid_target';

export type TargetingOutcome =
  | { readonly kind: 'state'; readonly state: TargetingState }
  /** Tutto scelto (o nulla da scegliere): si può mandare `cast_spell`. */
  | { readonly kind: 'cast'; readonly card: HandCard; readonly targets: readonly Square[]; readonly choice: PieceKind | null }
  | { readonly kind: 'refused'; readonly reason: TargetingRefusal };

/** Bersagli completi: si passa alla scelta del pezzo, se serve, altrimenti il cast è pronto. */
function afterTargets(card: HandCard, spell: Spell, chosen: readonly Square[], ctx: ChoiceContext): TargetingOutcome {
  const options = spellChoiceOptions(spell.effects, ctx);
  if (options === null) return { kind: 'cast', card, targets: chosen, choice: null };
  return { kind: 'state', state: { kind: 'choosing', card, spell, chosen, options } };
}

/** Avvia il cast di una carta: senza bersagli si va alla scelta (o al cast), altrimenti si entra in targeting. */
export function beginTargeting(card: HandCard, spell: Spell, ctx: ChoiceContext): TargetingOutcome {
  if (!targetsSupported(spell)) return { kind: 'refused', reason: 'unsupported_target' };
  if (spell.targets.length === 0) return afterTargets(card, spell, [], ctx);
  return { kind: 'state', state: { kind: 'collecting', card, spell, chosen: [] } };
}

/** Caselle valide al passo corrente: quelle che la scacchiera evidenzia e le uniche cliccabili. */
export function targetingCandidates(state: TargetingState, ctx: TargetContext): readonly Square[] {
  if (state.kind !== 'collecting') return [];
  return spellTargets(state.spell, ctx, state.chosen);
}

/** Casella scelta: avanza di un passo, e all'ultimo passa alla scelta o al cast. Una casella non valida viene rifiutata. */
export function pickTarget(state: TargetingState, ctx: TargetContext, square: Square): TargetingOutcome {
  if (state.kind !== 'collecting') return { kind: 'state', state };
  if (!targetingCandidates(state, ctx).includes(square)) return { kind: 'refused', reason: 'invalid_target' };
  const chosen = [...state.chosen, square];
  if (chosen.length >= state.spell.targets.length) return afterTargets(state.card, state.spell, chosen, ctx);
  return { kind: 'state', state: { ...state, chosen } };
}

/** Pezzo scelto: il cast è pronto. Un pezzo fuori dalle opzioni viene ignorato. */
export function pickChoice(state: TargetingState, piece: PieceKind): TargetingOutcome {
  if (state.kind !== 'choosing' || !state.options.includes(piece)) return { kind: 'state', state };
  return { kind: 'cast', card: state.card, targets: state.chosen, choice: piece };
}

/** Istruzione del passo corrente, già localizzata. */
export function targetingPrompt(state: TargetingState, t: TFunction): string | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'choosing') return t('spells.prompt.choice');
  return targetPrompt(t, state.spell, state.chosen.length);
}
