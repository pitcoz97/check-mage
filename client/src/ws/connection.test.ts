import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiResult } from '../api/endpoints';
import type { WsTicket } from '../api/types';
import { createLogger } from '../lib/log';
import { fakeSockets } from '../testing/fakeSocket';
import {
  BACKOFF,
  backoffDelay,
  CLOSE_REPLACED,
  createConnection,
  SEND_SPACING_MS,
  type ConnectionDeps,
  type ConnectionStatus,
} from './connection';

const silent = createLogger(() => undefined);
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(overrides: Partial<ConnectionDeps> & { ticketReplies?: ApiResult<WsTicket>[] } = {}) {
  const sockets = fakeSockets();
  const frames: string[] = [];
  const statuses: ConnectionStatus['kind'][] = [];
  let issued = 0;
  const replies = overrides.ticketReplies ?? [];
  const tickets = {
    fetchWsTicket: vi.fn(async (): Promise<ApiResult<WsTicket>> => {
      const scripted = replies.shift();
      if (scripted !== undefined) return scripted;
      issued++;
      return { ok: true, value: { ticket: `t${issued}`, expiresInSeconds: 30 } };
    }),
  };
  const connection = createConnection({
    wsBaseUrl: 'ws://mock/ws',
    tickets,
    onFrame: (raw) => frames.push(raw),
    createSocket: sockets.factory,
    random: () => 0,
    log: silent,
    ...overrides,
  });
  connection.subscribe((s) => statuses.push(s.kind));
  return { connection, sockets, frames, statuses, tickets };
}

describe('backoffDelay', () => {
  it('1s, 2s, 4s… con tetto a 30s; jitter in [d, 1,25d], mai sotto 1s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffDelay(n, () => 0))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(backoffDelay(1, () => 1)).toBe(1_250);
    expect(backoffDelay(5, () => 1)).toBe(20_000);
    expect(backoffDelay(6, () => 1)).toBe(BACKOFF.capMs);
  });
});

describe('connessione', () => {
  it('apertura con ticket nuovo, frame inoltrati', async () => {
    const { connection, sockets, frames, statuses } = setup();
    connection.open();
    await flush();
    expect(sockets.last().url).toBe('ws://mock/ws?ticket=t1');
    sockets.last().open();
    sockets.last().receive('{"type":"hand"}');
    expect(frames).toEqual(['{"type":"hand"}']);
    expect(statuses).toEqual(['connecting', 'open']);
    expect(connection.getStatus()).toEqual({ kind: 'open' });
  });

  it('chiusura imprevista → backoff crescente, ticket nuovo a ogni tentativo, azzerato dopo un’apertura', async () => {
    const { connection, sockets, tickets } = setup();
    connection.open();
    await flush();
    sockets.last().open();
    sockets.last().drop();
    expect(connection.getStatus()).toMatchObject({ kind: 'reconnecting', attempt: 1 });

    await vi.advanceTimersByTimeAsync(999);
    expect(sockets.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.last().url).toBe('ws://mock/ws?ticket=t2');
    sockets.last().drop(); // upgrade fallito (401, 429 o rete: il browser non li distingue)
    expect(connection.getStatus()).toMatchObject({ kind: 'reconnecting', attempt: 2 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets.last().url).toBe('ws://mock/ws?ticket=t3');
    sockets.last().open();
    expect(tickets.fetchWsTicket).toHaveBeenCalledTimes(3);

    sockets.last().drop();
    expect(connection.getStatus()).toMatchObject({ kind: 'reconnecting', attempt: 1 });
  });

  it('il countdown parte dall’inizio della disconnessione, non dall’ultimo tentativo', async () => {
    const { connection, sockets } = setup();
    connection.open();
    await flush();
    sockets.last().open();
    const start = Date.now();
    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connection.getStatus()).toMatchObject({ kind: 'connecting', since: start });
    sockets.last().drop();
    expect(connection.getStatus()).toMatchObject({ kind: 'reconnecting', since: start });
  });

  it('4001: connessione sostituita, nessuna riconnessione', async () => {
    const { connection, sockets } = setup();
    connection.open();
    await flush();
    sockets.last().open();
    sockets.last().drop(CLOSE_REPLACED);
    expect(connection.getStatus()).toEqual({ kind: 'replaced' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.sockets).toHaveLength(1);

    connection.open(); // "Riprendi qui"
    await flush();
    expect(sockets.sockets).toHaveLength(2);
  });

  it('chiusura voluta: il socket si chiude e non riparte', async () => {
    const { connection, sockets } = setup();
    connection.open();
    await flush();
    sockets.last().open();
    connection.close();
    expect(sockets.last().closedWith).toBe(1000);
    sockets.last().drop(1000); // l'evento di chiusura arriva dopo: va ignorato
    expect(connection.getStatus()).toEqual({ kind: 'closed' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });

  it('chiusura durante la richiesta del ticket: nessun socket aperto', async () => {
    const { connection, sockets } = setup();
    connection.open();
    connection.close();
    await flush();
    expect(sockets.sockets).toHaveLength(0);
  });

  it('ticket 401 dopo il refresh → sessione scaduta, stop; errore di rete → si riprova', async () => {
    const unauthorized = setup({ ticketReplies: [{ ok: false, error: { status: 401, code: 'token_invalid_or_expired' } }] });
    unauthorized.connection.open();
    await flush();
    expect(unauthorized.connection.getStatus()).toEqual({ kind: 'unauthorized' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(unauthorized.sockets.sockets).toHaveLength(0);

    const offline = setup({ ticketReplies: [{ ok: false, error: { status: 0, code: 'network_error' } }] });
    offline.connection.open();
    await flush();
    expect(offline.connection.getStatus()).toMatchObject({ kind: 'reconnecting', attempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(offline.sockets.last().url).toBe('ws://mock/ws?ticket=t1');
  });

  it('nudge anticipa il tentativo in attesa (evento online)', async () => {
    const { connection, sockets } = setup();
    connection.open();
    await flush();
    sockets.last().open();
    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(10);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(backoffDelay(i + 1, () => 0));
      sockets.last().drop();
    }
    expect(connection.getStatus()).toMatchObject({ kind: 'reconnecting', attempt: 4 });
    connection.nudge();
    await flush();
    expect(sockets.sockets).toHaveLength(5);
  });

  it('heartbeat (C10): in partita un silenzio oltre silenceMs chiude e riconnette', async () => {
    const { connection, sockets } = setup({ silenceMs: 5_000 });
    connection.open();
    await flush();
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(connection.getStatus()).toEqual({ kind: 'open' }); // in coda il traffico non è atteso

    connection.expectTraffic(true);
    await vi.advanceTimersByTimeAsync(4_000);
    sockets.last().receive('{"type":"timer_update"}');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(connection.getStatus()).toEqual({ kind: 'open' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets.sockets[0]?.closedWith).toBe(1000);
    expect(connection.getStatus()).toMatchObject({ kind: 'reconnecting', attempt: 1 });
  });

  it('invii distanziati di almeno 220 ms; niente invii a socket chiuso', async () => {
    const { connection, sockets } = setup();
    expect(connection.send({ type: 'resign' })).toBe(false);
    connection.open();
    await flush();
    sockets.last().open();
    expect(connection.send({ type: 'pass_phase' })).toBe(true);
    expect(connection.send({ type: 'move', move: 'e2e4' })).toBe(true);
    expect(sockets.last().sent).toEqual(['{"type":"pass_phase","payload":{}}']);
    await vi.advanceTimersByTimeAsync(SEND_SPACING_MS);
    expect(sockets.last().sent).toHaveLength(2);
    expect(JSON.parse(sockets.last().sent[1] ?? '')).toEqual({ type: 'move', payload: { move: 'e2e4' } });
  });

  it('parametri extra dell’URL (scenario del mock)', async () => {
    const { connection, sockets } = setup({ extraParams: { scenario: 'spells' } });
    connection.open();
    await flush();
    expect(sockets.last().url).toBe('ws://mock/ws?ticket=t1&scenario=spells');
  });
});
