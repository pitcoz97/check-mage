import type { TFunction } from 'i18next';

import type { HandCard, Square } from './model';
import { spellTargets, targetResolver, type TargetContext } from '../spells/targets.registry';
import type { Spell } from '../spells/schema';

/**
 * Macchina di targeting: dalla carta scelta alla lista di caselle da mandare al server (briefing §7.5).
 *
 * È pura e non conosce la connessione: dice solo cosa evidenziare, cosa rifiutare e quando il cast è pronto.
 * `targets` esce nell'ordine in cui il server lo vuole (`["e4"]`, oppure `["e4","e6"]` per lo spostamento, G3).
 */

export type TargetingState =
  | { readonly kind: 'idle' }
  /** Bersagli in corso di scelta: `chosen.length` è anche il passo corrente. */
  | { readonly kind: 'collecting'; readonly card: HandCard; readonly spell: Spell; readonly chosen: readonly Square[] };

export const TARGETING_IDLE: TargetingState = { kind: 'idle' };

export type TargetingRefusal = 'unsupported_target' | 'invalid_target';

export type TargetingOutcome =
  | { readonly kind: 'state'; readonly state: TargetingState }
  /** Tutti i bersagli scelti (o nessuno richiesto): si può mandare `cast_spell`. */
  | { readonly kind: 'cast'; readonly card: HandCard; readonly targets: readonly Square[] }
  | { readonly kind: 'refused'; readonly reason: TargetingRefusal };

/** Avvia il cast di una carta: senza bersagli parte subito, altrimenti si entra in modalità targeting. */
export function beginTargeting(card: HandCard, spell: Spell): TargetingOutcome {
  const resolver = targetResolver(spell.targetType);
  if (resolver === null) return { kind: 'refused', reason: 'unsupported_target' };
  if (resolver.count === 0) return { kind: 'cast', card, targets: [] };
  return { kind: 'state', state: { kind: 'collecting', card, spell, chosen: [] } };
}

/** Caselle valide al passo corrente: quelle che la scacchiera evidenzia e le uniche cliccabili. */
export function targetingCandidates(state: TargetingState, ctx: TargetContext): readonly Square[] {
  if (state.kind === 'idle') return [];
  return spellTargets(state.spell, ctx, state.chosen.length);
}

/** Casella scelta: avanza di un passo, e all'ultimo produce il cast. Una casella non valida viene rifiutata. */
export function pickTarget(state: TargetingState, ctx: TargetContext, square: Square): TargetingOutcome {
  if (state.kind === 'idle') return { kind: 'state', state };
  if (!targetingCandidates(state, ctx).includes(square)) return { kind: 'refused', reason: 'invalid_target' };
  const chosen = [...state.chosen, square];
  const count = targetResolver(state.spell.targetType)?.count ?? chosen.length;
  if (chosen.length >= count) return { kind: 'cast', card: state.card, targets: chosen };
  return { kind: 'state', state: { ...state, chosen } };
}

/** Istruzione del passo corrente, già localizzata dal registry dei bersagli. */
export function targetingPrompt(state: TargetingState, t: TFunction): string | null {
  if (state.kind === 'idle') return null;
  const resolver = targetResolver(state.spell.targetType);
  return resolver === null ? null : resolver.prompt(t, state.chosen.length);
}
