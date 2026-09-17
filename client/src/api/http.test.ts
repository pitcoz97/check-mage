import { describe, expect, it, vi } from 'vitest';

import { createHttpClient, type RefreshResult, type SessionPort } from './http';

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const unauthorized = () => new Response(JSON.stringify({ success: false, error: 'Token non valido o scaduto' }), { status: 401 });

function setup(responses: (Response | Error)[], refreshResult: RefreshResult = 'refreshed') {
  let token = 'old';
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), auth: headers['Authorization'] ?? null });
    const next = responses.shift();
    if (next === undefined) throw new Error('nessuna risposta preparata');
    if (next instanceof Error) throw next;
    return next;
  });
  const session: SessionPort = {
    getAccessToken: () => token,
    refresh: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      if (refreshResult === 'refreshed') token = 'new';
      return refreshResult;
    }),
    expire: vi.fn(),
  };
  const http = createHttpClient({ baseUrl: 'http://api', session, fetchImpl });
  return { http, session, calls };
}

describe('http client', () => {
  it('inietta il Bearer solo sulle richieste autenticate e interpreta tramite adapter', async () => {
    const { http, calls } = setup([ok({ id: 1 }), ok(null)]);
    expect(await http.request('GET', '/me', { auth: true })).toEqual({ ok: true, data: { id: 1 }, warnings: [] });
    await http.request('GET', '/leaderboard');
    expect(calls).toEqual([
      { url: 'http://api/me', auth: 'Bearer old' },
      { url: 'http://api/leaderboard', auth: null },
    ]);
  });

  it('401 → refresh → un solo retry con il token nuovo', async () => {
    const { http, session, calls } = setup([unauthorized(), ok({ id: 1 })]);
    const outcome = await http.request('GET', '/me', { auth: true });
    expect(outcome.ok).toBe(true);
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.auth)).toEqual(['Bearer old', 'Bearer new']);
    expect(session.expire).not.toHaveBeenCalled();
  });

  it('richieste concorrenti con 401 condividono un solo refresh', async () => {
    const { http, session } = setup([unauthorized(), unauthorized(), ok(1), ok(2)]);
    const results = await Promise.all([http.request('GET', '/me', { auth: true }), http.request('GET', '/me', { auth: true })]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh rifiutato → scadenza una volta sola, nessun retry', async () => {
    const { http, session, calls } = setup([unauthorized(), unauthorized()], 'rejected');
    const results = await Promise.all([http.request('GET', '/me', { auth: true }), http.request('GET', '/me', { auth: true })]);
    expect(results.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(['token_invalid_or_expired', 'token_invalid_or_expired']);
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(session.expire).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it('401 anche dopo il retry → scadenza e fine, senza loop', async () => {
    const { http, session, calls } = setup([unauthorized(), unauthorized()]);
    const outcome = await http.request('GET', '/me', { auth: true });
    expect(outcome.ok).toBe(false);
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(session.expire).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it('errore di rete → network_error, la sessione non scade', async () => {
    const { http, session } = setup([new TypeError('fetch failed')]);
    expect(await http.request('GET', '/me', { auth: true })).toMatchObject({ ok: false, error: { status: 0, code: 'network_error' } });
    expect(session.expire).not.toHaveBeenCalled();
  });

  it('refresh irraggiungibile → network_error, la sessione non scade', async () => {
    const { http, session } = setup([unauthorized()], 'unreachable');
    expect(await http.request('GET', '/me', { auth: true })).toMatchObject({ ok: false, error: { code: 'network_error' } });
    expect(session.expire).not.toHaveBeenCalled();
  });
});
