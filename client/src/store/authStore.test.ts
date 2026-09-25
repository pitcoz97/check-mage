import { describe, expect, it } from 'vitest';

import { ACCOUNT, data, fail, fakeServer, LOGIN, memoryStorage } from '../testing/fakes';
import { createAuth } from './authStore';

describe('authStore', () => {
  it('bootstrap senza sessione → anonymous', async () => {
    const { storage } = memoryStorage();
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: fakeServer({}).fetchImpl });
    await store.getState().bootstrap();
    expect(store.getState().status).toBe('anonymous');
  });

  it('login salva i token; un nuovo store sullo stesso storage (tab riaperta) è autenticato', async () => {
    const { storage } = memoryStorage();
    const server = fakeServer({ 'POST /auth/login': () => data(LOGIN), 'GET /me': () => data(ACCOUNT) });
    const first = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
    expect(await first.store.getState().login('mario@test.it', 'Password1')).toEqual({ ok: true });
    expect(first.store.getState()).toMatchObject({ status: 'authenticated', account: { username: 'mario' } });

    const reopened = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
    await reopened.store.getState().bootstrap();
    expect(reopened.store.getState()).toMatchObject({ status: 'authenticated', account: { createdAt: ACCOUNT.created_at } });
  });

  it('login fallito restituisce il codice, lo stato non cambia', async () => {
    const { storage, map } = memoryStorage();
    const server = fakeServer({ 'POST /auth/login': () => fail(401, 'Credenziali non valide') });
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
    await store.getState().bootstrap();
    expect(await store.getState().login('x@y.it', 'bad')).toEqual({ ok: false, error: { status: 401, code: 'invalid_credentials' } });
    expect(store.getState().status).toBe('anonymous');
    expect(map.size).toBe(0);
  });

  it('bootstrap con access scaduto: refresh e sessione valida', async () => {
    const { storage } = memoryStorage();
    await storage.set('session', JSON.stringify({ accessToken: 'expired', refreshToken: 'r1' }));
    const server = fakeServer({
      'GET /me': (init) =>
        (init?.headers as Record<string, string>)['Authorization'] === 'Bearer a2' ? data(ACCOUNT) : fail(401, 'Token non valido o scaduto'),
      'POST /auth/refresh': () => data({ access_token: 'a2', refresh_token: 'r2' }),
    });
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
    await store.getState().bootstrap();
    expect(store.getState().status).toBe('authenticated');
    expect(JSON.parse((await storage.get('session')) ?? '{}')).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(server.hits).toEqual(['GET /me', 'POST /auth/refresh', 'GET /me']);
  });

  it('bootstrap con refresh scaduto: logout pulito con notice, nessun loop', async () => {
    const { storage, map } = memoryStorage();
    await storage.set('session', JSON.stringify({ accessToken: 'expired', refreshToken: 'expired' }));
    const server = fakeServer({
      'GET /me': () => fail(401, 'Token non valido o scaduto'),
      'POST /auth/refresh': () => fail(401, 'Refresh token non valido o scaduto'),
    });
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
    await store.getState().bootstrap();
    expect(store.getState()).toMatchObject({ status: 'anonymous', account: null, notice: 'session_expired' });
    expect(map.size).toBe(0);
    expect(server.hits).toEqual(['GET /me', 'POST /auth/refresh']);
  });

  it('bootstrap con server irraggiungibile: unreachable, la sessione resta salvata', async () => {
    const { storage } = memoryStorage();
    await storage.set('session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: fakeServer({}).fetchImpl });
    await store.getState().bootstrap();
    expect(store.getState().status).toBe('unreachable');
    expect(await storage.get('session')).not.toBeNull();
  });

  it('sessione corrotta in storage: scartata', async () => {
    const { storage, map } = memoryStorage();
    await storage.set('session', '{"accessToken": 42');
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: fakeServer({}).fetchImpl });
    await store.getState().bootstrap();
    expect(store.getState().status).toBe('anonymous');
    expect(map.size).toBe(0);
  });

  it('registrazione con login automatico; login fallito dopo la registrazione', async () => {
    const { storage } = memoryStorage();
    const server = fakeServer({ 'POST /auth/register': () => data({ user_id: 7 }), 'POST /auth/login': () => data(LOGIN) });
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
    expect(await store.getState().register('mario', 'mario@test.it', 'Password1')).toEqual({ ok: true });
    expect(store.getState().status).toBe('authenticated');

    const taken = fakeServer({ 'POST /auth/register': () => fail(409, 'Username o email già in uso') });
    const other = createAuth({ baseUrl: 'http://api', storage: memoryStorage().storage, fetchImpl: taken.fetchImpl });
    expect(await other.store.getState().register('mario', 'mario@test.it', 'Password1')).toEqual({
      ok: false,
      stage: 'register',
      error: { status: 409, code: 'username_or_email_taken' },
    });

    const loginDown = fakeServer({ 'POST /auth/register': () => data({ user_id: 8 }) });
    const third = createAuth({ baseUrl: 'http://api', storage: memoryStorage().storage, fetchImpl: loginDown.fetchImpl });
    expect(await third.store.getState().register('luigi', 'luigi@test.it', 'Password1')).toMatchObject({ ok: false, stage: 'login' });
  });

  it('logout cancella tutto', async () => {
    const { storage, map } = memoryStorage();
    const server = fakeServer({ 'POST /auth/login': () => data(LOGIN) });
    const { store } = createAuth({ baseUrl: 'http://api', storage, fetchImpl: server.fetchImpl });
    await store.getState().login('mario@test.it', 'Password1');
    await store.getState().logout();
    expect(store.getState()).toMatchObject({ status: 'anonymous', account: null, notice: null });
    expect(map.size).toBe(0);
  });
});
