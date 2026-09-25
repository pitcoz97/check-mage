import type { MockConfig } from '../config';
import type { MatchOverrides } from '../game/match';
import type { BotBehavior } from './bot';
import type { ScenarioName } from './names';

export interface ScenarioSetup {
  /** `null` = nessun bot: il client entra in coda con altri client reali. */
  bot: BotBehavior | null;
  /** Solo scenari: preparazione di mani e mazzi, mana minimo. Il server reale non li ha. */
  overrides?: MatchOverrides;
  baseTimeMs?: number;
  hostile?: boolean;
}

/** Negli scenari con bot il client è sempre il bianco (primo in coda, `game/manager.go:49-66`). */
export function setupScenario(name: ScenarioName, config: MockConfig): ScenarioSetup {
  const comeBack = Math.min(3000, Math.floor(config.reconnectTimeoutMs / 2));
  switch (name) {
    case 'pvp':
      return { bot: null };
    case 'checkmate':
      return { bot: { script: ['e7e5', 'b8c6', 'g8f6'] } };
    case 'abandon':
      return { bot: { afterMoves: { count: 1, action: 'disconnect', returnAfterMs: null } } };
    case 'reconnect':
      return { bot: { afterMoves: { count: 1, action: 'disconnect', returnAfterMs: comeBack } } };
    case 'restart':
      return { bot: { afterMoves: { count: 1, action: 'restart', returnAfterMs: comeBack } } };
    case 'timeout':
      return { bot: { stall: true }, baseTimeMs: Math.min(config.baseTimeMs, 15_000) };
    case 'draw':
      return { bot: { offerDrawOnFirstTurn: true, declineDrawsBeforeAccepting: 1 } };
    case 'spells':
      return {
        bot: { castSpells: true },
        overrides: {
          hand: { black: ['blood_pact', 'conscription', 'frost', 'shield'] },
          deckTop: { black: ['forced_march', 'ice_chain', 'blink'] },
          manaFloor: { black: 10 },
        },
      };
    case 'spellbook':
      return {
        // Il bot muove pedoni tranquilli e non casta: la scacchiera resta prevedibile mentre il client lancia.
        bot: { script: ['a7a6', 'b7b6', 'h7h6', 'g7g6', 'a6a5'] },
        overrides: {
          // Mano più larga delle 4 carte regolamentari: è uno scenario di prova, serve a coprire tutti gli effetti
          // in pochi turni.
          hand: { white: ['frost', 'ice_chain', 'shatter', 'blood_pact', 'blink', 'shield', 'royal_shield', 'forced_march', 'conscription'] },
          manaFloor: { white: 10 },
        },
      };
    case 'hostile':
      return { bot: {}, hostile: true };
  }
}
