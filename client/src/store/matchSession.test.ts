import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../lib/log';
import { ACCOUNT, data, fakeServer, memoryStorage } from '../testing/fakes';
import { fakeSockets } from '../testing/fakeSocket';
import { createAuth } from './authStore';
import { createMatchSession } from './matchSession';

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const { storage, map } = memoryStorage();
  await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
  let ticket = 0;
  const server = fakeServer({
    'GET /me': () => data(ACCOUNT),
    'GET /ws/ticket': () => data({ ticket: `t${++ticket}`, expires_in: 30 }),
  });
  const auth = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
  await auth.store.getState().bootstrap();
  const sockets = fakeSockets();
  const online = new EventTarget();
  // Ripresa dell'app dal background, come la manderebbe `@capacitor/app` su dispositivo.
  const resumeListeners = new Set<() => void>();
  const session = createMatchSession({
    wsBaseUrl: 'ws://api/ws',
    tickets: auth.api,
    auth: auth.store,
    storage,
    createSocket: sockets.factory,
    log: createLogger(() => undefined),
    onlineEvents: online,
    appEvents: {
      subscribe(onResume) {
        resumeListeners.add(onResume);
        return () => resumeListeners.delete(onResume);
      },
    },
  });
  const resume = () => resumeListeners.forEach((listener) => listener());
  return { session, sockets, auth, map, online, server, resume, resumeListeners };
}

/** `game_state` in cui l'utente di `ACCOUNT` (id 7) gioca con il bianco. */
const gameState = (status = 'active') => ({
  type: 'game_state',
  payload: {
    board: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], turn: 'white', status },
    white_player: { id: 7, username: 'mario' },
    black_player: { id: 8, username: 'luigi' },
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
});

describe('sessione di partita', () => {
  it('coda → partita (flag salvato, colore) → fine (flag cancellato)', async () => {
    const { session, sockets, map } = await setup();
    session.findMatch();
    await flush();
    expect(session.match.getState().lifecycle).toBe('queued');
    expect(sockets.last().url).toBe('ws://api/ws?ticket=t1');
    sockets.last().open();
    expect(session.status.getState().connection.kind).toBe('open');

    sockets.last().receive(gameState());
    await flush();
    expect(session.match.getState()).toMatchObject({ lifecycle: 'playing', myColor: 'white' });
    expect(map.get('checkmage:active-match')).toBe('7');
    expect(await session.hasSavedMatch()).toBe(true);

    sockets.last().receive({ type: 'game_over', payload: { result: '1-0', reason: 'resign', winner: 'mario' } });
    await flush();
    expect(session.match.getState().lifecycle).toBe('over');
    expect(map.has('checkmage:active-match')).toBe(false);
  });

  it('Annulla chiude la connessione (uscita dalla coda) e azzera lo stato', async () => {
    const { session, sockets } = await setup();
    session.findMatch();
    await flush();
    sockets.last().open();
    session.cancel();
    expect(sockets.last().closedWith).toBe(1000);
    expect(session.match.getState().lifecycle).toBe('idle');
    expect(session.status.getState().connection.kind).toBe('closed');
  });

  it('in partita il silenzio porta alla riconnessione; l’evento online la anticipa', async () => {
    const { session, sockets, online } = await setup();
    session.findMatch();
    await flush();
    sockets.last().open();
    sockets.last().receive(gameState());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.status.getState().connection).toMatchObject({ kind: 'reconnecting', attempt: 1 });
    online.dispatchEvent(new Event('online'));
    await flush();
    expect(sockets.sockets).toHaveLength(2);
    expect(sockets.last().url).toBe('ws://api/ws?ticket=t2');
  });

  it('ripresa dell’app: il socket riparte e lo stato arriva dal server', async () => {
    const { session, sockets, resume } = await setup();
    session.findMatch();
    await flush();
    sockets.last().open();
    sockets.last().receive(gameState());
    expect(session.match.getState().lifecycle).toBe('playing');

    // L'app torna in primo piano: il socket di prima è morto in background senza dirlo.
    resume();
    await flush();
    expect(sockets.sockets).toHaveLength(2);
    expect(sockets.sockets[0]?.closedWith).toBe(1000);
    sockets.last().open();
    sockets.last().receive(gameState());
    expect(session.match.getState().lifecycle).toBe('playing');
  });

  it('logout: connessione chiusa e stato azzerato', async () => {
    const { session, sockets, auth } = await setup();
    session.findMatch();
    await flush();
    sockets.last().open();
    sockets.last().receive(gameState());
    await auth.store.getState().logout();
    expect(sockets.last().closedWith).toBe(1000);
    expect(session.match.getState()).toMatchObject({ lifecycle: 'idle', selfId: null, game: null });
  });

  it('partita salvata di un altro utente: non si riprende', async () => {
    const { session, map } = await setup();
    map.set('checkmage:active-match', '99');
    expect(await session.hasSavedMatch()).toBe(false);
  });
});
