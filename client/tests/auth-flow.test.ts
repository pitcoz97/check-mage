import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startMockServer, type MockServerHandle } from '../mock-server/index';
import { createAuth } from '../src/store/authStore';
import { memoryStorage } from '../src/testing/fakes';

/**
 * Criteri di accettazione dello Step 2, contro il mock (porting di chess-server):
 * - login e sessione ancora valida dopo aver "chiuso e riaperto la tab" (nuovo store, stesso storage);
 * - access token scaduto: un solo refresh e la sessione prosegue;
 * - refresh non valido: logout pulito, senza loop di retry.
 */

let server: MockServerHandle;
const hits: string[] = [];
const countingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  hits.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`);
  return fetch(url, init);
}) as typeof fetch;

beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true, accessTokenTtlSeconds: 1 });
});
afterAll(async () => {
  await server.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('flusso di autenticazione contro il mock', () => {
  const { storage, map } = memoryStorage();
  const newTab = () => createAuth({ baseUrl: server.httpUrl, storage, fetchImpl: countingFetch });

  it('registrazione con login automatico', async () => {
    const tab = newTab();
    expect(await tab.store.getState().register('flusso_e2e', 'flusso@e2e.test', 'Password1')).toEqual({ ok: true });
    expect(tab.store.getState()).toMatchObject({ status: 'authenticated', account: { username: 'flusso_e2e', elo: 1200 } });
    expect(map.size).toBe(1);
  });

  it('tab chiusa e riaperta: la sessione è ancora valida', async () => {
    hits.length = 0;
    const reopened = newTab();
    await reopened.store.getState().bootstrap();
    expect(reopened.store.getState()).toMatchObject({ status: 'authenticated', account: { email: 'flusso@e2e.test' } });
    expect(hits).toEqual(['GET /me']);
  });

  it('access token scaduto: un solo refresh, poi la richiesta riesce', async () => {
    await sleep(2100);
    hits.length = 0;
    const tab = newTab();
    await tab.store.getState().bootstrap();
    expect(tab.store.getState().status).toBe('authenticated');
    expect(hits).toEqual(['GET /me', 'POST /auth/refresh', 'GET /me']);

    const profile = await tab.api.fetchPublicProfile(tab.store.getState().account?.id ?? '');
    expect(profile).toMatchObject({ ok: true, value: { stats: { total: 0 } } });
  });

  it('refresh non valido: logout pulito, nessun loop', async () => {
    await storage.set('session', JSON.stringify({ accessToken: 'scaduto', refreshToken: 'non-valido' }));
    hits.length = 0;
    const tab = newTab();
    await tab.store.getState().bootstrap();
    expect(tab.store.getState()).toMatchObject({ status: 'anonymous', account: null, notice: 'session_expired' });
    expect(hits).toEqual(['GET /me', 'POST /auth/refresh']);
    expect(map.size).toBe(0);

    // Anche una richiesta autenticata successiva non riprova all'infinito.
    hits.length = 0;
    const me = await tab.api.fetchAccount();
    expect(me).toMatchObject({ ok: false, error: { status: 401 } });
    expect(hits).toEqual(['GET /me']);
  });
});
