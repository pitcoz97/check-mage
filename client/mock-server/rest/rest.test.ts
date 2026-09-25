import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { createTicketStore } from '../auth/tickets';
import { DEFAULT_CONFIG, type MockConfig } from '../config';
import { startMockServer, type MockServerHandle } from '../index';
import { clientKey, isTrustedProxy } from './rateLimit';

/**
 * REST e autenticazione del mock contro il contratto di `fix/backend-requests`: ticket WebSocket, access token
 * obbligatorio (B3), rate limit per IP (B15), rotte nuove, 404/405 in JSON (B12).
 */

const servers: MockServerHandle[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers.length = 0;
});

async function start(overrides: Partial<MockConfig> = {}): Promise<MockServerHandle> {
  const server = await startMockServer({ port: 0, quiet: true, ...overrides });
  servers.push(server);
  return server;
}

async function call(server: MockServerHandle, method: string, path: string, init: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token !== undefined) headers['Authorization'] = `Bearer ${init.token}`;
  const res = await fetch(`${server.httpUrl}${path}`, {
    method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: unknown; error?: string } };
}

async function login(server: MockServerHandle, name: string) {
  const email = `${name}@test.local`;
  await call(server, 'POST', '/auth/register', { body: { username: name, email, password: 'Password1' } });
  const res = await call(server, 'POST', '/auth/login', { body: { email, password: 'Password1' } });
  return (res.body.data as { tokens: { access_token: string; refresh_token: string } }).tokens;
}

/** Esito dell'upgrade WebSocket: `open` oppure lo status HTTP del rifiuto. */
function upgrade(url: string): Promise<'open' | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('open', () => {
      ws.terminate();
      resolve('open');
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.once('error', () => undefined);
  });
}

describe('ticket WebSocket (middleware/wsticket.go, handlers/ws.go)', () => {
  it('GET /ws/ticket richiede l’access token e il ticket vale una volta sola', async () => {
    const server = await start({ scenario: 'timeout' });
    const tokens = await login(server, 'ticket_user');
    expect((await call(server, 'GET', '/ws/ticket')).status).toBe(401);

    const res = await call(server, 'GET', '/ws/ticket', { token: tokens.access_token });
    expect(res.status).toBe(200);
    const { ticket, expires_in } = res.body.data as { ticket: string; expires_in: number };
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(expires_in).toBe(30);

    expect(await upgrade(`${server.wsUrl}?ticket=${ticket}`)).toBe('open');
    expect(await upgrade(`${server.wsUrl}?ticket=${ticket}`)).toBe(401);
    expect(await upgrade(`${server.wsUrl}?ticket=inventato`)).toBe(401);
  });

  it('un ticket scaduto viene rifiutato, e consumato comunque', () => {
    let now = 0;
    const store = createTicketStore(30_000, () => now);
    const claims = { user_id: 1, username: 'u', type: 'access' as const, exp: 0 };
    const fresh = store.issue(claims);
    expect(store.consume(fresh)).toEqual(claims);
    const late = store.issue(claims);
    now = 30_001;
    expect(store.consume(late)).toBeNull();
    now = 0;
    expect(store.consume(late)).toBeNull();
  });
});

describe('access token obbligatorio (B3, middleware/auth.go:56-75)', () => {
  it('un refresh token non apre /me né il WebSocket', async () => {
    const server = await start();
    const tokens = await login(server, 'b3_user');
    expect((await call(server, 'GET', '/me', { token: tokens.refresh_token })).body).toEqual({
      success: false,
      error: 'Token non valido o scaduto',
    });
    expect(await upgrade(`${server.wsUrl}?token=${tokens.refresh_token}`)).toBe(401);
    expect((await call(server, 'GET', '/me', { token: tokens.access_token })).status).toBe(200);
  });
});

describe('rate limit per IP (B15, middleware/ratelimit.go:101-145)', () => {
  it('la chiave è l’IP senza porta; gli header di proxy valgono solo da un proxy fidato', () => {
    expect(clientKey({}, '::ffff:127.0.0.1', [])).toBe('127.0.0.1');
    expect(clientKey({ 'x-forwarded-for': '9.9.9.9' }, '10.0.0.5', [])).toBe('10.0.0.5');
    expect(clientKey({ 'x-forwarded-for': '9.9.9.9, 10.0.0.7' }, '10.0.0.5', ['10.0.0.0/8'])).toBe('9.9.9.9');
    expect(clientKey({ 'x-real-ip': '8.8.8.8' }, '10.0.0.5', ['10.0.0.5'])).toBe('8.8.8.8');
    expect(isTrustedProxy('192.168.1.10', ['192.168.1.0/24'])).toBe(true);
    expect(isTrustedProxy('192.168.2.10', ['192.168.1.0/24'])).toBe(false);
  });

  it('connessioni diverse dallo stesso IP condividono il limite auth, refresh compreso', async () => {
    const server = await start({
      rateLimits: { ...(DEFAULT_CONFIG.rateLimits as Exclude<MockConfig['rateLimits'], false>), auth: { rate: 0.001, burst: 3 } },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      // fetch apre connessioni nuove: con la chiave ip:porta di prima ognuna avrebbe avuto un limiter proprio.
      statuses.push((await call(server, 'POST', '/auth/refresh', { body: { refresh_token: 'x' } })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });
});

describe('rotte (api/router.go)', () => {
  it('GET /spells: il catalogo per costo e poi per id', async () => {
    const server = await start();
    const res = await call(server, 'GET', '/spells');
    const spells = res.body.data as { id: string; mana_cost: number }[];
    expect(spells).toHaveLength(18);
    const order = spells.map((s) => `${s.mana_cost}:${s.id}`);
    expect(order).toEqual(
      [...spells]
        .sort((a, b) => a.mana_cost - b.mana_cost || a.id.localeCompare(b.id))
        .map((s) => `${s.mana_cost}:${s.id}`),
    );
    expect(spells[0]?.id).toBe('blood_pact');
  });

  it('GET /auth/password-policy', async () => {
    const server = await start();
    expect((await call(server, 'GET', '/auth/password-policy')).body.data).toEqual({
      username: { min_length: 3, max_length: 20, pattern: '^[a-zA-Z0-9_]+$' },
      password: { min_length: 8, max_length: 72, require_uppercase: true, require_lowercase: true, require_digit: true },
    });
  });

  it('liste vuote come [] (B8)', async () => {
    const server = await start();
    const tokens = await login(server, 'b8_user');
    expect((await call(server, 'GET', '/users/1/games', { token: tokens.access_token })).body.data).toEqual([]);
  });

  it('404 e 405 nell’inviluppo JSON (B12)', async () => {
    const server = await start();
    expect(await call(server, 'GET', '/non-esiste')).toEqual({ status: 404, body: { success: false, error: 'Risorsa non trovata' } });
    expect(await call(server, 'POST', '/me')).toEqual({ status: 405, body: { success: false, error: 'Metodo non consentito' } });
  });
});
