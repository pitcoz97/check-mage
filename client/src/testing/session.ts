import type { KeyValueStorage } from '../lib/storage';
import { createLogger } from '../lib/log';
import type { Auth } from '../store/authStore';
import { createMatchSession, type MatchSession } from '../store/matchSession';
import { fakeSockets } from './fakeSocket';

/** Sessione di partita per i test dei componenti: socket finti, log muto, niente evento `online`. */
export function testMatchSession(auth: Auth, storage: KeyValueStorage): { session: MatchSession; sockets: ReturnType<typeof fakeSockets> } {
  const sockets = fakeSockets();
  const session = createMatchSession({
    wsBaseUrl: 'ws://api/ws',
    tickets: auth.api,
    auth: auth.store,
    storage,
    createSocket: sockets.factory,
    log: createLogger(() => undefined),
    onlineEvents: null,
  });
  return { session, sockets };
}
