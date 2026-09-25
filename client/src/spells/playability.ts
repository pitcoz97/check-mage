import type { TFunction } from 'i18next';

import type { Phase } from '../game/model';
import type { Spell } from './schema';
import { targetResolver } from './targets.registry';

/**
 * Perché una carta non è giocabile ora. I controlli sono nello stesso ordine del server
 * (`match/match.go:203-215`, porting in `mock-server/game/match.ts:203`), così il motivo mostrato è quello che
 * direbbe lui: la carta resta visibile e disabilitata col motivo, mai nascosta (briefing §7.5).
 */

export const CARD_REFUSALS = [
  'not_playing',
  'not_connected',
  'not_your_turn',
  'wrong_phase',
  'insufficient_mana',
  'unknown_spell',
  'unsupported_target',
  'cast_pending',
] as const;
export type CardRefusal = (typeof CARD_REFUSALS)[number];

export interface CastContext {
  readonly playing: boolean;
  readonly connected: boolean;
  readonly myTurn: boolean;
  readonly phase: Phase | 'unknown';
  readonly mana: number;
  /** Un cast è già partito e aspetta la risposta del server: niente doppio invio. */
  readonly castPending: boolean;
}

/** `null` se la carta si può lanciare adesso. `spell` assente = `spell_id` che il catalogo non conosce. */
export function cardRefusal(spell: Spell | undefined, ctx: CastContext): CardRefusal | null {
  if (spell === undefined) return 'unknown_spell';
  // Senza resolver il client non sa quante caselle chiedere: meglio non mandare nulla (ASSUMPTIONS C14).
  if (targetResolver(spell.targetType) === null) return 'unsupported_target';
  if (!ctx.playing) return 'not_playing';
  if (!ctx.connected) return 'not_connected';
  if (!ctx.myTurn) return 'not_your_turn';
  if (!spell.phases.includes(ctx.phase)) return 'wrong_phase';
  if (ctx.mana < spell.manaCost) return 'insufficient_mana';
  if (ctx.castPending) return 'cast_pending';
  return null;
}

export function cardRefusalMessage(t: TFunction, reason: CardRefusal, spell: Spell | undefined): string {
  return reason === 'insufficient_mana'
    ? t('spells.refusal.insufficient_mana', { cost: spell?.manaCost ?? 0 })
    : t(`spells.refusal.${reason}`);
}
