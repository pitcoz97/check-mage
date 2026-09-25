import { describe, expect, it } from 'vitest';

import { createAuth } from '../store/authStore';
import { data, fail, fakeServer, memoryStorage } from '../testing/fakes';

/** Endpoint pubblici letti dalle schermate: il dato arriva normalizzato dall'adapter, l'errore col suo codice. */
describe('fetchLeaderboard', () => {
  it('restituisce la classifica normalizzata, senza token', async () => {
    const server = fakeServer({ 'GET /leaderboard': () => data([{ rank: 1, id: 3, username: 'alice', elo: 1640 }]) });
    const { api } = createAuth({ baseUrl: 'http://api', storage: memoryStorage().storage, fetchImpl: server.fetchImpl });
    expect(await api.fetchLeaderboard()).toEqual({ ok: true, value: [{ rank: 1, id: '3', username: 'alice', elo: 1640 }] });
    expect(server.hits).toEqual(['GET /leaderboard']);
  });

  it('un errore del server resta un errore', async () => {
    const server = fakeServer({ 'GET /leaderboard': () => fail(500, 'Errore DB') });
    const { api } = createAuth({ baseUrl: 'http://api', storage: memoryStorage().storage, fetchImpl: server.fetchImpl });
    expect((await api.fetchLeaderboard()).ok).toBe(false);
  });
});
