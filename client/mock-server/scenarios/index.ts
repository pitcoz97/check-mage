import type { MockConfig } from '../config';
import type { PlayerConnection, RoomOptions } from '../game/room';
import type { BotBehavior } from './bot';
import { wrapHostile } from './hostile';
import type { ScenarioName } from './names';

export interface ScenarioSetup {
  /** `null` = nessun bot: il client entra in matchmaking con altri client reali. */
  bot: BotBehavior | null;
  room: Pick<Partial<RoomOptions>, 'clockMs' | 'reconnectTimeoutMs' | 'variant' | 'deckTop' | 'startingMaxMana'>;
  wrapHuman?: (conn: PlayerConnection) => PlayerConnection;
}

/** Il client (umano) è sempre il bianco negli scenari con bot, così le sequenze sono prevedibili. */
export function setupScenario(name: ScenarioName, config: MockConfig): ScenarioSetup {
  switch (name) {
    case 'pvp':
      return { bot: null, room: {} };
    case 'checkmate':
      // Matto del barbiere: il client gioca e2e4, d1h5, f1c4, h5f7.
      return { bot: { script: ['e7e5', 'b8c6', 'g8f6'] }, room: {} };
    case 'abandon':
      return { bot: { disconnectAfterMoves: 1, reconnectAfterMs: null }, room: {} };
    case 'reconnect':
      return {
        bot: { disconnectAfterMoves: 1, reconnectAfterMs: Math.min(3000, Math.floor(config.reconnectTimeoutMs / 2)) },
        room: {},
      };
    case 'timeout':
      return { bot: { stall: true }, room: { clockMs: Math.min(config.clockMs, 15_000) } };
    case 'draw':
      return { bot: { offerDrawOnFirstTurn: true, acceptDraws: true }, room: {} };
    case 'spells':
      return {
        bot: { castSpells: true },
        room: {
          startingMaxMana: 10,
          deckTop: { black: ['recover', 'shield', 'ice_age', 'greed', 'teleport', 'fireball'] },
        },
      };
    case 'hostile':
      return { bot: {}, room: {}, wrapHuman: wrapHostile };
    case 'contract-minimal':
      return { bot: {}, room: { variant: 'minimal' } };
  }
}
