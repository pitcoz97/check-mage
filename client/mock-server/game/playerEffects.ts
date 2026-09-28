import type { Color } from './fen';
import type { DrawResult } from './match';

/**
 * Porting di `spells/player_effects.go` e della parte pura di `game/events.go` (Step 5): trigger e aure vivono nel
 * `PlayerState`; le reazioni di un'azione si raccolgono in un `EventLog` e si trasmettono alla fine.
 */

export const TRIGGER_ON_OWN_PIECE_LOST = 'own_piece_lost';
export const TRIGGER_ON_SHIELDED_ATTACKED = 'shielded_piece_attacked';
export const TRIGGER_DO_DRAW_CARD = 'draw_card';
export const TRIGGER_DO_FREEZE_ATTACKER = 'freeze_attacker';
export const AURA_CONDITION_OWN_PAWNS_GTE = 'own_pawns_gte';
export const PERMANENT_TURNS = -1;

/** `spells.Trigger` (JSON dello snapshot). */
export interface Trigger {
  on: string;
  do: string;
  amount: number;
  remaining_turns: number;
  hidden?: boolean;
  one_shot?: boolean;
  source_spell_id: string;
}

/** `spells.Aura`. */
export interface Aura {
  grant: string;
  min_own_pawns: number;
  active: boolean;
  source_spell_id: string;
}

/** `triggerFired` (`events.go`): payload di `trigger_fired`. */
export interface TriggerFired {
  player: Color;
  on: string;
  do: string;
  source_spell_id: string;
  result: Record<string, unknown>;
}

/** `auraChange`: payload di `aura_changed`. */
export interface AuraChange {
  player: Color;
  grant: string;
  active: boolean;
}

/** `playerEffects`: le liste viste da un giocatore. */
export interface PlayerEffectsView {
  triggers: Record<string, unknown>[];
  auras: Record<string, unknown>[];
}

/** `eventLog`: le reazioni di un'azione; `views` è la fotografia delle liste se sono cambiate. */
export interface EventLog {
  fired: TriggerFired[];
  draws: DrawResult[];
  auras: AuraChange[];
  playerEffects: boolean;
  views: Record<Color, PlayerEffectsView> | null;
}

export function newEventLog(): EventLog {
  return { fired: [], draws: [], auras: [], playerEffects: false, views: null };
}

/** `PlayerState.TickTriggers`: le regole di `TickTurnEnd`; `true` se qualcuno è scaduto. */
export function tickTriggers(triggers: Trigger[], ownerFinished: boolean): { kept: Trigger[]; expired: boolean } {
  let expired = false;
  const kept = triggers.filter((t) => {
    if (t.remaining_turns === PERMANENT_TURNS) return true;
    if (!ownerFinished) t.remaining_turns--;
    if (t.remaining_turns > 0) return true;
    expired = true;
    return false;
  });
  return { kept, expired };
}

/** `playerEffectsFor(viewer)`: i trigger nascosti dell'avversario non ci sono. */
export function playerEffectsFor(
  viewer: Color,
  states: Record<Color, { triggers?: Trigger[]; auras?: Aura[] }>,
): PlayerEffectsView {
  const out: PlayerEffectsView = { triggers: [], auras: [] };
  for (const player of ['white', 'black'] as const) {
    for (const t of states[player].triggers ?? []) {
      if (t.hidden === true && player !== viewer) continue;
      const view: Record<string, unknown> = {
        player,
        on: t.on,
        do: t.do,
        remaining_turns: t.remaining_turns,
        source_spell_id: t.source_spell_id,
      };
      if (t.hidden === true) view['hidden'] = true;
      out.triggers.push(view);
    }
    for (const a of states[player].auras ?? []) {
      out.auras.push({ player, grant: a.grant, active: a.active, min_own_pawns: a.min_own_pawns, source_spell_id: a.source_spell_id });
    }
  }
  return out;
}
