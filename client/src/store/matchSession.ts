import { createStore, type StoreApi } from 'zustand/vanilla';

import type { UserId } from '../game/model';
import { log as defaultLog, type Logger } from '../lib/log';
import { STORAGE_KEYS, type KeyValueStorage } from '../lib/storage';
import { createConnection, type Connection, type ConnectionStatus, type SocketFactory, type TicketSource } from '../ws/connection';
import { routeFrame } from '../ws/dispatch';
import type { ClientIntent } from '../ws/protocol';
import type { AuthState } from './authStore';
import { createMatchStore, type MatchStoreState } from './matchStore';

/**
 * Sessione di partita: collega la sessione utente, la connessione WebSocket e il `matchStore`.
 *
 * Il server non ha un endpoint per sapere se l'utente ha una partita in corso, e aprire il socket senza partita
 * mette l'utente in coda. Per riprendere una partita dopo un ricaricamento il client ricorda quindi, in `storage.ts`,
 * l'id dell'utente con una partita aperta (ASSUMPTIONS C11, BACKEND-REQUESTS P2-13).
 */

/**
 * Finestra di rientro del server (`RECONNECT_TIMEOUT`, default 30s, `config/config.go:68`). Il server non la espone:
 * serve solo al countdown del banner (ASSUMPTIONS C12, BACKEND-REQUESTS P2-12).
 */
export const RECONNECT_WINDOW_MS = 30_000;

export interface SessionState {
  readonly connection: ConnectionStatus;
}

export interface MatchSession {
  readonly match: StoreApi<MatchStoreState>;
  readonly status: StoreApi<SessionState>;
  /** Entra in coda (nuova connessione). */
  findMatch(): void;
  /** Esce dalla coda chiudendo la connessione (`LeaveQueue`, `game/client.go:81-88`). */
  cancel(): void;
  /** Riapre la connessione: dopo una sostituzione (4001) o per riprendere una partita salvata. */
  resume(): void;
  /** Chiude la connessione e dimentica la partita (fine partita, ritorno alla lobby). */
  leave(): void;
  /** `true` se questo utente aveva una partita aperta quando la pagina è stata chiusa o ricaricata. */
  hasSavedMatch(): Promise<boolean>;
  send(intent: ClientIntent): boolean;
  dispose(): void;
}

export interface MatchSessionDeps {
  readonly wsBaseUrl: string;
  readonly tickets: TicketSource;
  readonly auth: StoreApi<AuthState>;
  readonly storage: KeyValueStorage;
  readonly createSocket?: SocketFactory;
  readonly log?: Logger;
  readonly silenceMs?: number;
  /** Solo mock: parametri extra dell'URL del socket (`scenario`). */
  readonly extraParams?: Readonly<Record<string, string>>;
  /** Sorgente dell'evento `online` (di default la finestra, se c'è). */
  readonly onlineEvents?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}

export function createMatchSession(deps: MatchSessionDeps): MatchSession {
  const logger = deps.log ?? defaultLog;
  const selfIdOf = (state: AuthState): UserId | null => (state.status === 'authenticated' ? (state.account?.id ?? null) : null);
  let selfId = selfIdOf(deps.auth.getState());
  const match = createMatchStore(selfId);

  const connection: Connection = createConnection({
    wsBaseUrl: deps.wsBaseUrl,
    tickets: deps.tickets,
    onFrame: (raw) => routeFrame(raw, match.getState(), logger),
    log: logger,
    ...(deps.createSocket === undefined ? {} : { createSocket: deps.createSocket }),
    ...(deps.silenceMs === undefined ? {} : { silenceMs: deps.silenceMs }),
    ...(deps.extraParams === undefined ? {} : { extraParams: deps.extraParams }),
  });
  const status = createStore<SessionState>()(() => ({ connection: connection.getStatus() }));
  const unsubscribers: (() => void)[] = [];
  unsubscribers.push(connection.subscribe((next) => status.setState({ connection: next })));

  // Partita salvata e controllo del silenzio seguono il ciclo di vita della partita.
  unsubscribers.push(
    match.subscribe((next, previous) => {
      if (next.lifecycle === previous.lifecycle) return;
      connection.expectTraffic(next.lifecycle === 'playing');
      if (next.lifecycle === 'playing' && next.selfId !== null) void deps.storage.set(STORAGE_KEYS.activeMatch, next.selfId);
      if (next.lifecycle === 'over') void deps.storage.remove(STORAGE_KEYS.activeMatch);
    }),
  );

  // Logout, sessione scaduta o cambio utente: la connessione si chiude e lo stato di partita riparte da zero.
  unsubscribers.push(
    deps.auth.subscribe((next) => {
      const nextId = selfIdOf(next);
      if (nextId === selfId) return;
      selfId = nextId;
      connection.close();
      match.getState().reset(nextId);
    }),
  );

  const online = deps.onlineEvents === undefined ? (typeof window === 'undefined' ? null : window) : deps.onlineEvents;
  const onOnline = () => connection.nudge();
  online?.addEventListener('online', onOnline);
  unsubscribers.push(() => online?.removeEventListener('online', onOnline));

  return {
    match,
    status,

    findMatch() {
      match.getState().enterQueue();
      connection.open();
    },

    cancel() {
      connection.close();
      match.getState().reset(selfId);
    },

    resume() {
      connection.open();
    },

    leave() {
      connection.close();
      void deps.storage.remove(STORAGE_KEYS.activeMatch);
      match.getState().reset(selfId);
    },

    async hasSavedMatch() {
      return selfId !== null && (await deps.storage.get(STORAGE_KEYS.activeMatch)) === selfId;
    },

    send: (intent) => connection.send(intent),

    dispose() {
      connection.close();
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}
