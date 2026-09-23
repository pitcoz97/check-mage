import type { ApiResult } from '../api/endpoints';
import { encodeClientIntent } from '../api/adapter';
import type { HttpErrorInfo, WsTicket } from '../api/types';
import { log as defaultLog, type Logger } from '../lib/log';
import type { ClientIntent } from './protocol';

/**
 * Connessione WebSocket: unico punto del client che conosce la strategia di autenticazione del socket.
 *
 * - **Ticket monouso** (chess-server `middleware/wsticket.go`): `GET /ws/ticket` con il Bearer, poi `/ws?ticket=…`
 *   entro 30 secondi. Un ticket vale una volta sola: se ne chiede uno nuovo a ogni apertura. Il JWT non finisce
 *   nell'URL né nei log di accesso.
 * - **Riconnessione** con backoff esponenziale e jitter (briefing §8), mai sotto 1s: l'upgrade è limitato a 1/s per IP
 *   (`middleware/ratelimit.go:158`). Il browser non distingue un 401 all'upgrade (ticket scaduto) da un 429 o da un
 *   errore di rete: in tutti i casi si riprova con un ticket nuovo.
 * - **Niente riconnessione** su 4001 (connessione sostituita da un'altra dello stesso utente, `game/client.go:28`),
 *   su chiusura voluta, o se il ticket è rifiutato anche dopo il refresh (sessione scaduta).
 * - **Heartbeat (ASSUMPTIONS C10):** il browser non espone i ping; in partita arriva un `timer_update` al secondo,
 *   quindi un silenzio prolungato vuol dire socket morto. Nessun ping applicativo: un `type` sconosciuto riceverebbe
 *   `unknown_message_type` e consumerebbe il rate limit.
 * - **Uscita distanziata:** il server accetta ~5 messaggi/s per connessione (`handlers/ws.go:60`).
 */

// ---------------------------------------------------------------------------------------------------
// URL e ticket
// ---------------------------------------------------------------------------------------------------

export function buildSocketUrl(wsBaseUrl: string, ticket: string): string {
  const url = new URL(wsBaseUrl);
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

export interface TicketSource {
  fetchWsTicket(): Promise<ApiResult<WsTicket>>;
}

export type SocketUrlResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: HttpErrorInfo };

/** Chiede un ticket nuovo e costruisce l'URL di apertura. Un 401 sul ticket passa dal refresh di `http.ts`. */
export async function resolveSocketUrl(source: TicketSource, wsBaseUrl: string): Promise<SocketUrlResult> {
  const ticket = await source.fetchWsTicket();
  return ticket.ok ? { ok: true, url: buildSocketUrl(wsBaseUrl, ticket.value.ticket) } : { ok: false, error: ticket.error };
}

// ---------------------------------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------------------------------

/** Codice di chiusura di una connessione sostituita (`game/client.go:28`). */
export const CLOSE_REPLACED = 4001;
const CLOSE_NORMAL = 1000;

export interface SocketHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(code: number): void;
}

export interface SocketHandle {
  send(data: string): void;
  close(code?: number): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketHandle;

/** `WebSocket` standard: il browser e Node 22 (nativo) espongono la stessa API. `onerror` è sempre seguito da `onclose`. */
export const nativeSocketFactory: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.onOpen();
  ws.onmessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') handlers.onMessage(event.data);
  };
  ws.onclose = (event: CloseEvent) => handlers.onClose(event.code);
  return {
    send: (data) => ws.send(data),
    close: (code = CLOSE_NORMAL) => ws.close(code),
  };
};

// ---------------------------------------------------------------------------------------------------
// Macchina a stati
// ---------------------------------------------------------------------------------------------------

export type ConnectionStatus =
  | { readonly kind: 'idle' }
  /** `since` non nullo: è un tentativo di rientro dopo una disconnessione. */
  | { readonly kind: 'connecting'; readonly attempt: number; readonly since: number | null }
  | { readonly kind: 'open' }
  /** `since`: inizio della disconnessione (per il countdown della finestra di rientro); `nextAt`: prossimo tentativo. */
  | { readonly kind: 'reconnecting'; readonly attempt: number; readonly since: number; readonly nextAt: number }
  /** Un'altra connessione dello stesso utente ha preso il posto di questa (4001). */
  | { readonly kind: 'replaced' }
  /** Ticket rifiutato anche dopo il refresh: la sessione è scaduta. */
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'closed' };

export const BACKOFF = { baseMs: 1_000, capMs: 30_000, jitter: 0.25 } as const;
/** Distanza minima tra due messaggi in uscita: sotto i 5/s del server, con margine. */
export const SEND_SPACING_MS = 220;
/** Silenzio oltre il quale, in partita, il socket è considerato morto. */
export const DEFAULT_SILENCE_MS = 5_000;

/** Attesa prima del tentativo `attempt` (da 1): 1s, 2s, 4s… con jitter in [d, d·1,25], tetto 30s. */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF.capMs, BACKOFF.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.min(BACKOFF.capMs, Math.round(base * (1 + BACKOFF.jitter * random())));
}

export interface ConnectionDeps {
  readonly wsBaseUrl: string;
  readonly tickets: TicketSource;
  readonly onFrame: (raw: string) => void;
  readonly createSocket?: SocketFactory;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly silenceMs?: number;
  /** Parametri extra dell'URL (solo mock: `scenario`). */
  readonly extraParams?: Readonly<Record<string, string>>;
  readonly log?: Logger;
}

export interface Connection {
  getStatus(): ConnectionStatus;
  subscribe(listener: (status: ConnectionStatus) => void): () => void;
  /** Apre la connessione (o la riapre dopo `replaced`/`closed`/`unauthorized`). No-op se è già aperta o in corso. */
  open(): void;
  /** Chiusura voluta: nessuna riconnessione. */
  close(): void;
  /** Se sta aspettando il prossimo tentativo, lo anticipa (evento `online`). */
  nudge(): void;
  /**
   * Ripresa dell'app dopo il background (Android chiude il socket senza avvisare, briefing §8): se la connessione
   * non è ferma per scelta, si riparte subito con un ticket nuovo invece di fidarsi di un socket che potrebbe
   * essere già morto. Il server rimanda lo stato completo a chi rientra entro la finestra (G5).
   */
  wake(): void;
  /** In partita il traffico è continuo (`timer_update`): attiva il controllo del silenzio. */
  expectTraffic(expected: boolean): void;
  /** Invia un intento; `false` se il socket non è aperto (l'azione non parte). */
  send(intent: ClientIntent): boolean;
}

export function createConnection(deps: ConnectionDeps): Connection {
  const createSocket = deps.createSocket ?? nativeSocketFactory;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const silenceMs = deps.silenceMs ?? DEFAULT_SILENCE_MS;
  const logger = deps.log ?? defaultLog;

  let status: ConnectionStatus = { kind: 'idle' };
  const listeners = new Set<(status: ConnectionStatus) => void>();
  /** Ogni apertura o chiusura incrementa la generazione: gli eventi di socket vecchi vengono ignorati. */
  let generation = 0;
  let socket: SocketHandle | null = null;
  let attempt = 0;
  let disconnectedSince: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let expecting = false;
  let nextSendAt = 0;

  function setStatus(next: ConnectionStatus): void {
    status = next;
    for (const listener of [...listeners]) listener(next);
  }

  function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer !== null) clearTimeout(timer);
    return null;
  }

  function dropSocket(code: number): void {
    const current = socket;
    socket = null;
    silenceTimer = clearTimer(silenceTimer);
    current?.close(code);
  }

  function armSilence(): void {
    silenceTimer = clearTimer(silenceTimer);
    if (!expecting || status.kind !== 'open') return;
    silenceTimer = setTimeout(() => {
      logger.warn(`connessione silenziosa da ${silenceMs} ms: riconnessione (C10)`);
      generation++;
      dropSocket(CLOSE_NORMAL);
      scheduleRetry();
    }, silenceMs);
  }

  function scheduleRetry(): void {
    attempt++;
    disconnectedSince ??= now();
    const delay = backoffDelay(attempt, random);
    setStatus({ kind: 'reconnecting', attempt, since: disconnectedSince, nextAt: now() + delay });
    retryTimer = clearTimer(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  }

  async function connect(): Promise<void> {
    const gen = ++generation;
    setStatus({ kind: 'connecting', attempt, since: disconnectedSince });
    let resolved: SocketUrlResult;
    try {
      resolved = await resolveSocketUrl(deps.tickets, deps.wsBaseUrl);
    } catch {
      resolved = { ok: false, error: { status: 0, code: 'network_error' } };
    }
    if (gen !== generation) return; // chiusa o riaperta nel frattempo
    if (!resolved.ok) {
      if (resolved.error.status === 401) {
        logger.warn('ticket WebSocket rifiutato dopo il refresh: sessione scaduta');
        setStatus({ kind: 'unauthorized' });
        return;
      }
      logger.debug('ticket WebSocket non disponibile', resolved.error);
      scheduleRetry();
      return;
    }

    const url = new URL(resolved.url);
    for (const [key, value] of Object.entries(deps.extraParams ?? {})) url.searchParams.set(key, value);
    socket = createSocket(url.toString(), {
      onOpen() {
        if (gen !== generation) return;
        attempt = 0;
        disconnectedSince = null;
        nextSendAt = 0;
        setStatus({ kind: 'open' });
        armSilence();
      },
      onMessage(data) {
        if (gen !== generation) return;
        armSilence();
        deps.onFrame(data);
      },
      onClose(code) {
        if (gen !== generation) return;
        socket = null;
        silenceTimer = clearTimer(silenceTimer);
        if (code === CLOSE_REPLACED) {
          logger.debug('connessione sostituita da un’altra dello stesso utente (4001)');
          setStatus({ kind: 'replaced' });
          return;
        }
        scheduleRetry();
      },
    });
  }

  return {
    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    open() {
      if (status.kind === 'open' || status.kind === 'connecting' || status.kind === 'reconnecting') return;
      attempt = 0;
      disconnectedSince = null;
      void connect();
    },

    close() {
      generation++;
      retryTimer = clearTimer(retryTimer);
      dropSocket(CLOSE_NORMAL);
      attempt = 0;
      disconnectedSince = null;
      if (status.kind !== 'idle' && status.kind !== 'closed') setStatus({ kind: 'closed' });
    },

    nudge() {
      if (status.kind !== 'reconnecting') return;
      retryTimer = clearTimer(retryTimer);
      void connect();
    },

    wake() {
      // Ferma per scelta (mai aperta, chiusa, sessione scaduta, sostituita da un'altra scheda): non si tocca.
      if (status.kind === 'idle' || status.kind === 'closed' || status.kind === 'unauthorized' || status.kind === 'replaced') return;
      generation++;
      retryTimer = clearTimer(retryTimer);
      dropSocket(CLOSE_NORMAL);
      attempt = 0;
      void connect();
    },

    expectTraffic(expected) {
      expecting = expected;
      armSilence();
    },

    send(intent) {
      const current = socket;
      if (current === null || status.kind !== 'open') return false;
      const frame = encodeClientIntent(intent);
      const gen = generation;
      const t = now();
      const at = Math.max(t, nextSendAt);
      nextSendAt = at + SEND_SPACING_MS;
      if (at === t) current.send(frame);
      else
        setTimeout(() => {
          if (gen === generation) socket?.send(frame);
        }, at - t);
      return true;
    },
  };
}
