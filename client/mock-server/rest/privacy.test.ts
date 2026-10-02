import { afterEach, describe, expect, it } from 'vitest';

import type { MockConfig } from '../config';
import { startMockServer, type MockServerHandle } from '../index';

/** Privacy e conformità (`handlers/privacy.go`, `handlers/auth.go`, P1–P10). */

const servers: MockServerHandle[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers.length = 0;
});

async function start(overrides: Partial<MockConfig> = {}): Promise<MockServerHandle> {
  const server = await startMockServer({ port: 0, quiet: true, rateLimits: false, ...overrides });
  servers.push(server);
  return server;
}

type Body = { success: boolean; data?: unknown; error?: string };

async function call(server: MockServerHandle, method: string, path: string, init: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token !== undefined) headers['Authorization'] = `Bearer ${init.token}`;
  const res = await fetch(`${server.httpUrl}${path}`, { method, headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  return { status: res.status, body: (await res.json()) as Body };
}

async function player(server: MockServerHandle, name: string) {
  const email = `${name}@test.local`;
  await call(server, 'POST', '/auth/register', { body: { username: name, email, password: 'Password1', accept_terms: true, age_confirmed: true } });
  const login = await call(server, 'POST', '/auth/login', { body: { email, password: 'Password1' } });
  const data = login.body.data as { tokens: { access_token: string }; user: { id: number; terms_version: number; terms_current: number } };
  return { id: data.user.id, token: data.tokens.access_token, user: data.user, email };
}

describe('consenso e termini (P1–P2)', () => {
  it('la registrazione pretende termini ed età; login e /me portano le versioni', async () => {
    const server = await start();
    const missing = await call(server, 'POST', '/auth/register', { body: { username: 'anna', email: 'anna@test.local', password: 'Password1', accept_terms: true } });
    expect(missing).toMatchObject({ status: 400, body: { error: 'Devi accettare i termini e confermare di avere almeno 14 anni' } });
    const anna = await player(server, 'anna');
    expect(anna.user).toMatchObject({ terms_version: 1, terms_current: 1 });
    const me = (await call(server, 'GET', '/me', { token: anna.token })).body.data as Record<string, unknown>;
    expect(me).toMatchObject({ terms_version: 1, terms_current: 1, hide_presence: false });
    expect(typeof me['terms_accepted_at']).toBe('string');
    expect((await call(server, 'POST', '/me/terms', { token: anna.token, body: { version: 2 } })).body.error).toBe('Versione dei termini non valida');
    expect((await call(server, 'POST', '/me/terms', { token: anna.token, body: { version: 1 } })).status).toBe(200);
  });
});

describe('stato nascosto (P6)', () => {
  it('chi nasconde lo stato appare offline e non riceve sfide', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/presence', { token: bruno.token });
    const hidden = await call(server, 'PUT', '/me/privacy', { token: bruno.token, body: { hide_presence: true } });
    expect(hidden.body.data).toMatchObject({ hide_presence: true });
    const list = (await call(server, 'GET', '/me/friends', { token: anna.token })).body.data as { others: { id: number; status: string }[]; online: number };
    expect(list.others.find((f) => f.id === bruno.id)?.status).toBe('offline');
    expect(list.online).toBe(0);
    expect((await call(server, 'POST', '/me/challenges', { token: anna.token, body: { to: bruno.id } })).body.error).toBe('Il giocatore non è online');
    expect((await call(server, 'PUT', '/me/privacy', { token: bruno.token, body: {} })).status).toBe(400);
  });
});

describe('cancellazione ed esportazione (P3, P5)', () => {
  it('esporta account, collezione, mazzi, amicizie e bloccati', async () => {
    const server = await start();
    const [anna, bruno, carlo] = [await player(server, 'anna'), await player(server, 'bruno'), await player(server, 'carlo')];
    await call(server, 'POST', '/me/friends/requests', { token: anna.token, body: { to: bruno.id } });
    await call(server, 'POST', `/me/friends/requests/${anna.id}/accept`, { token: bruno.token });
    await call(server, 'POST', '/me/blocks', { token: anna.token, body: { user_id: carlo.id } });
    const exported = (await call(server, 'GET', '/me/export', { token: anna.token })).body.data as {
      exported_at: string;
      account: { email: string };
      collection: unknown[];
      decks: unknown[];
      games: unknown[];
      friends: { friends: { id: number }[]; others: unknown[] };
      blocked: { id: number }[];
    };
    expect(exported.account.email).toBe(anna.email);
    expect(exported.collection.length).toBeGreaterThan(0);
    expect(exported.decks.length).toBe(1);
    expect(exported.games).toEqual([]);
    expect(exported.friends.friends.map((f) => f.id)).toEqual([bruno.id]);
    expect(exported.friends.others).toEqual([]);
    expect(exported.blocked.map((b) => b.id)).toEqual([carlo.id]);
  });

  it('cancellazione: password, poi account anonimo, sparisce dagli elenchi, login impossibile', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/friends/requests', { token: anna.token, body: { to: bruno.id } });

    expect((await call(server, 'DELETE', '/me', { token: anna.token, body: { password: 'Sbagliata1' } })).body.error).toBe('Password non corretta');
    expect((await call(server, 'DELETE', '/me', { token: anna.token, body: { password: 'Password1' } })).status).toBe(200);

    expect((await call(server, 'GET', '/me', { token: anna.token })).status).toBe(404);
    expect((await call(server, 'GET', `/users/${anna.id}`)).status).toBe(404);
    const login = await call(server, 'POST', '/auth/login', { body: { email: anna.email, password: 'Password1' } });
    expect(login.status).toBe(401);
    const list = (await call(server, 'GET', '/me/friends', { token: bruno.token })).body.data as { others: { id: number }[]; incoming: unknown[] };
    expect(list.others.map((f) => f.id)).not.toContain(anna.id);
    expect(list.incoming).toEqual([]);
    expect((await call(server, 'GET', '/leaderboard')).body.data).toEqual([expect.objectContaining({ id: bruno.id })]);
    expect((await call(server, 'GET', '/users/search?q=anna', { token: bruno.token })).body.data).toEqual([]);
  });
});
