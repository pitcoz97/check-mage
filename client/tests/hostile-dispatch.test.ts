import { describe, expect, it } from 'vitest';

import { hostileSender, HOSTILE_FRAMES } from '../mock-server/scenarios/hostile';
import type { WireServerMessage } from '../mock-server/wire';
import { createLogger } from '../src/lib/log';
import { createMatchStore } from '../src/store/matchStore';
import { routeFrame } from '../src/ws/dispatch';

/**
 * Scenario "server ostile" (briefing §11, Step 3): i frame malformati del mock e i messaggi validi "decorati"
 * passano da dispatch e reducer senza eccezioni, e la partita resta coerente.
 */
describe('server ostile → dispatch → reducer', () => {
  it('nessun frame fa lanciare eccezioni; i frame non validi lasciano lo stato com’era', () => {
    const store = createMatchStore('1', () => 0);
    const logger = createLogger(() => undefined);
    for (const raw of HOSTILE_FRAMES) {
      const before = store.getState();
      const outcome = routeFrame(raw, store.getState(), logger);
      if (!outcome.ok) expect(store.getState()).toBe(before);
    }
  });

  it('messaggi validi con campi inattesi e frame ostili intercalati: lo stato di partita arriva comunque', () => {
    const store = createMatchStore('1', () => 0);
    const logger = createLogger(() => undefined);
    const frames: string[] = [];
    const send = hostileSender((text) => frames.push(text));
    const messages: WireServerMessage[] = [
      {
        type: 'game_state',
        payload: {
          board: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], turn: 'white', status: 'active' },
          white_player: { id: 1, username: 'mario' },
          black_player: { id: 2, username: 'luigi' },
          time_control: { base_ms: 600000, increment_ms: 5000 },
          white_time: 600000,
          black_time: 600000,
          phase: 'draw',
          active_player: 'white',
          turn_number: 1,
          white_mana: 1,
          white_max_mana: 1,
          black_mana: 1,
          black_max_mana: 1,
          white_hand_size: 4,
          black_hand_size: 4,
          white_deck_size: 36,
          black_deck_size: 36,
          active_effects: [],
        },
      },
      { type: 'hand', payload: { hand: ['spark', 'nova', 'aegis', 'jolt'], mana: 1, max_mana: 1, deck_size: 36 } },
      { type: 'phase_changed', payload: { phase: 'main1', active_player: 'white', turn_number: 1 } },
      { type: 'spell_cast', payload: { player: 'white', spell_id: 'spark', targets: [], effects_applied: [{ kind: 'noop' }] } },
      { type: 'timer_update', payload: { white_time: 599000, black_time: 600000, turn: 'white' } },
    ];
    for (const message of messages) send(message);
    for (const raw of frames) expect(() => routeFrame(raw, store.getState(), logger)).not.toThrow();
    expect(store.getState()).toMatchObject({ lifecycle: 'playing', myColor: 'white', game: { phase: 'main1' } });
    expect(store.getState().hand.map((c) => c.spellId)).toEqual(['nova', 'aegis', 'jolt']);
  });
});
