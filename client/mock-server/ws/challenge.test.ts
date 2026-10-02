import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import type { MockConfig } from '../config';
import { startMockServer, type MockServerHandle } from '../index';

/** Amici, presenza e sfide dirette (`handlers/friends.go`, `handlers/challenges.go`, `game/challenges.go`). */

const servers: MockServerHandle[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets.length = 0;
  await Promise.all(servers.map((s) => s.close()));
  servers.length = 0;
});

async function start(overrides: Partial<MockConfig> = {}): Promise<MockServerHandle> {
  const server = await startMockServer({ port: 0, quiet: true, rateLimits: false, ...overrides });
  servers.push(server);
  return server;
}

type Body = { success: boolean; data?: unknown; error?: string };

async function call(server: MockServerHandle, method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${server.httpUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Body };
}

interface Player {
  readonly id: number;
  readonly token: string;
}

async function player(server: MockServerHandle, name: string): Promise<Player> {
  const email = `${name}@test.local`;
  const post = (path: string, body: unknown) =>
    fetch(`${server.httpUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post('/auth/register', { username: name, email, password: 'Password1', accept_terms: true, age_confirmed: true });
  const login = (await (await post('/auth/login', { email, password: 'Password1' })).json()) as {
    data: { tokens: { access_token: string }; user: { id: number } };
  };
  return { id: login.data.user.id, token: login.data.tokens.access_token };
}

type Frame = { type: string; payload: Record<string, unknown> };

/** Un socket che raccoglie i frame; `closed` si risolve col codice di chiusura. */
function connect(server: MockServerHandle, p: Player, challenge: string) {
  const ws = new WebSocket(`${server.wsUrl}?token=${p.token}&challenge=${challenge}`);
  sockets.push(ws);
  const frames: Frame[] = [];
  ws.on('message', (data) => frames.push(JSON.parse(data.toString()) as Frame));
  const opened = new Promise<void>((resolve) => ws.once('open', () => resolve()));
  const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
  const next = (type: string) =>
    new Promise<Frame>((resolve) => {
      const found = frames.find((f) => f.type === type);
      if (found !== undefined) return resolve(found);
      const onMessage = () => {
        const hit = frames.find((f) => f.type === type);
        if (hit === undefined) return;
        ws.off('message', onMessage);
        resolve(hit);
      };
      ws.on('message', onMessage);
    });
  return { ws, frames, opened, closed, next };
}

const errorCodes = (frames: Frame[]) => frames.filter((f) => f.type === 'error').map((f) => f.payload['code']);

describe('amici e presenza', () => {
  it('GET /me/friends: senza amicizie tutti negli altri giocatori, prima gli online, poi per nome; se stessi esclusi', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await player(server, 'aldo');
    await call(server, 'POST', '/me/presence', bruno.token);
    const res = await call(server, 'GET', '/me/friends', anna.token);
    expect(res.body.data).toEqual({
      friends: [],
      incoming: [],
      outgoing: [],
      max_friends: 200,
      others: [
        { id: bruno.id, username: 'bruno', elo: 1200, status: 'online' },
        { id: 3, username: 'aldo', elo: 1200, status: 'offline' },
      ],
      online: 1,
    });
  });

  it('senza allFriends la lista è vuota', async () => {
    const server = await start({ allFriends: false });
    const anna = await player(server, 'anna');
    await player(server, 'bruno');
    expect((await call(server, 'GET', '/me/friends', anna.token)).body.data).toEqual({ friends: [], others: [], incoming: [], outgoing: [], online: 0, max_friends: 200 });
  });
});

describe('sfide dirette', () => {
  it('errori: corpo, se stessi, inesistente, offline', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    const challenge = (body: unknown) => call(server, 'POST', '/me/challenges', anna.token, body);
    expect((await challenge({ to: 'x' })).body.error).toBe('Dati non validi');
    expect((await challenge({ to: anna.id })).body.error).toBe('Non puoi sfidare te stesso');
    expect(await challenge({ to: 99 })).toMatchObject({ status: 404, body: { error: 'Giocatore non trovato' } });
    expect(await challenge({ to: bruno.id })).toMatchObject({ status: 409, body: { error: 'Il giocatore non è online' } });
  });

  it('sfida accettata: amichevole per tutti e due, in partita, niente ELO', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/presence', bruno.token);

    const created = await call(server, 'POST', '/me/challenges', anna.token, { to: bruno.id });
    expect(created.status).toBe(201);
    const ch = created.body.data as { id: string; from: { id: number }; to: { id: number }; expires_in: number };
    expect(ch).toMatchObject({ from: { id: anna.id, username: 'anna' }, to: { id: bruno.id }, expires_in: 60 });
    const incoming = (await call(server, 'POST', '/me/presence', bruno.token)).body.data as { incoming: { id: string }[] };
    expect(incoming.incoming.map((c) => c.id)).toEqual([ch.id]);

    const a = connect(server, anna, ch.id);
    await a.opened;
    const b = connect(server, bruno, ch.id);
    const [stateA, stateB] = await Promise.all([a.next('game_state'), b.next('game_state')]);
    expect(stateA.payload['friendly']).toBe(true);
    expect(stateB.payload['friendly']).toBe(true);
    expect((await call(server, 'POST', '/me/presence', bruno.token)).body.data).toEqual({ incoming: [], friend_requests: 0 });

    const friends = (await call(server, 'GET', '/me/friends', anna.token)).body.data as { others: { status: string }[] };
    expect(friends.others[0]?.status).toBe('playing');
    expect((await call(server, 'POST', '/me/challenges', anna.token, { to: bruno.id })).body.error).toBe('Sei già in partita');

    a.ws.send(JSON.stringify({ type: 'resign', payload: {} }));
    await b.next('game_over');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const games = (await call(server, 'GET', `/users/${anna.id}/games`, anna.token)).body.data as { rated: boolean; white_id: number }[];
    expect(games).toHaveLength(1);
    expect(games[0]?.rated).toBe(false);
    const me = (await call(server, 'GET', '/me', anna.token)).body.data as { elo: number };
    expect(me.elo).toBe(1200);
  });

  it('sfida rifiutata: chi aspetta riceve challenge_declined e la chiusura 4003', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/presence', bruno.token);
    const ch = (await call(server, 'POST', '/me/challenges', anna.token, { to: bruno.id })).body.data as { id: string };
    const a = connect(server, anna, ch.id);
    await a.opened;

    expect((await call(server, 'DELETE', `/me/challenges/${ch.id}`, (await player(server, 'carlo')).token)).status).toBe(404);
    expect((await call(server, 'DELETE', `/me/challenges/${ch.id}`, bruno.token)).status).toBe(200);
    expect(await a.closed).toBe(4003);
    expect(errorCodes(a.frames)).toEqual(['challenge_declined']);
  });

  it('sfida scaduta: challenge_expired; sfida sconosciuta: challenge_unavailable', async () => {
    const server = await start({ challengeTtlMs: 100 });
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/presence', bruno.token);
    const ch = (await call(server, 'POST', '/me/challenges', anna.token, { to: bruno.id })).body.data as { id: string };
    const a = connect(server, anna, ch.id);
    expect(await a.closed).toBe(4003);
    expect(errorCodes(a.frames)).toEqual(['challenge_expired']);

    const b = connect(server, bruno, 'nessuna');
    expect(await b.closed).toBe(4003);
    expect(errorCodes(b.frames)).toEqual(['challenge_unavailable']);
  });

  it('se chi sfida chiude il socket la sfida è annullata', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/presence', bruno.token);
    const ch = (await call(server, 'POST', '/me/challenges', anna.token, { to: bruno.id })).body.data as { id: string };
    const a = connect(server, anna, ch.id);
    await a.opened;
    a.ws.close();
    await a.closed;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await call(server, 'POST', '/me/presence', bruno.token)).body.data).toEqual({ incoming: [], friend_requests: 0 });
  });
});

describe('amicizie vere e blocchi (handlers/friendships.go)', () => {
  type List = { friends: { id: number }[]; others: { id: number }[]; incoming: { id: number }[]; outgoing: { id: number }[] };
  const ids = (items: { id: number }[]) => items.map((i) => i.id);

  it('richiesta, accetta, richiesta incrociata, rimuovi, rifiuta; badge nella presenza', async () => {
    const server = await start();
    const [anna, bruno, carlo] = [await player(server, 'anna'), await player(server, 'bruno'), await player(server, 'carlo')];
    const sent = await call(server, 'POST', '/me/friends/requests', anna.token, { to: bruno.id });
    expect(sent.status).toBe(201);
    expect(ids((sent.body.data as List).outgoing)).toEqual([bruno.id]);
    expect(ids((sent.body.data as List).others)).toEqual([carlo.id]);
    expect((await call(server, 'POST', '/me/presence', bruno.token)).body.data).toMatchObject({ friend_requests: 1 });
    expect((await call(server, 'POST', '/me/friends/requests', anna.token, { to: bruno.id })).body.error).toBe('Richiesta già inviata');
    expect((await call(server, 'POST', `/me/friends/requests/${bruno.id}/accept`, anna.token)).status).toBe(404);
    const accepted = await call(server, 'POST', `/me/friends/requests/${anna.id}/accept`, bruno.token);
    expect(ids((accepted.body.data as List).friends)).toEqual([anna.id]);
    expect((await call(server, 'POST', '/me/friends/requests', bruno.token, { to: anna.id })).body.error).toBe('Siete già amici');

    await call(server, 'POST', '/me/friends/requests', carlo.token, { to: anna.id });
    const crossed = await call(server, 'POST', '/me/friends/requests', anna.token, { to: carlo.id });
    expect(ids((crossed.body.data as List).friends).sort()).toEqual([bruno.id, carlo.id]);

    expect((await call(server, 'DELETE', `/me/friends/${bruno.id}`, anna.token)).status).toBe(200);
    expect((await call(server, 'DELETE', `/me/friends/${bruno.id}`, anna.token)).body.error).toBe('Amico non trovato');
    await call(server, 'POST', '/me/friends/requests', bruno.token, { to: anna.id });
    expect((await call(server, 'DELETE', `/me/friends/requests/${bruno.id}`, anna.token)).status).toBe(200);
    expect(ids(((await call(server, 'GET', '/me/friends', bruno.token)).body.data as List).outgoing)).toEqual([]);
  });

  it('ricerca per nome con la relazione; troppo corta; se stessi esclusi', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await player(server, 'brunella');
    await call(server, 'POST', '/me/friends/requests', anna.token, { to: bruno.id });
    expect((await call(server, 'GET', '/users/search?q=b', anna.token)).body.error).toBe('Ricerca troppo corta');
    const found = (await call(server, 'GET', '/users/search?q=BRU', anna.token)).body.data as { username: string; relation: string }[];
    expect(found.map((u) => [u.username, u.relation])).toEqual([
      ['brunella', 'none'],
      ['bruno', 'outgoing'],
    ]);
    expect((await call(server, 'GET', '/users/search?q=anna', anna.token)).body.data).toEqual([]);
  });

  it('blocco: niente richieste né sfide, nascosti a vicenda, sfida aperta chiusa; sblocco', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/presence', anna.token);
    await call(server, 'POST', '/me/presence', bruno.token);
    const ch = (await call(server, 'POST', '/me/challenges', bruno.token, { to: anna.id })).body.data as { id: string };
    const b = connect(server, bruno, ch.id);
    await b.opened;

    const blocked = await call(server, 'POST', '/me/blocks', anna.token, { user_id: bruno.id });
    expect(blocked.body.data).toEqual([{ id: bruno.id, username: 'bruno' }]);
    expect(await b.closed).toBe(4003);
    expect(errorCodes(b.frames)).toEqual(['challenge_unavailable']);
    expect(ids(((await call(server, 'GET', '/me/friends', anna.token)).body.data as List).others)).toEqual([]);
    expect(ids(((await call(server, 'GET', '/me/friends', bruno.token)).body.data as List).others)).toEqual([]);
    expect((await call(server, 'POST', '/me/friends/requests', bruno.token, { to: anna.id })).body.error).toBe('Giocatore non trovato');
    expect((await call(server, 'POST', '/me/challenges', bruno.token, { to: anna.id })).body.error).toBe('Giocatore non trovato');
    expect((await call(server, 'GET', '/users/search?q=anna', bruno.token)).body.data).toEqual([]);
    expect((await call(server, 'POST', '/me/blocks', anna.token, { user_id: anna.id })).body.error).toBe('Non puoi bloccare te stesso');

    expect((await call(server, 'DELETE', `/me/blocks/${bruno.id}`, anna.token)).body.data).toEqual([]);
    expect((await call(server, 'DELETE', `/me/blocks/${bruno.id}`, anna.token)).body.error).toBe('Giocatore non bloccato');
    expect(ids(((await call(server, 'GET', '/me/friends', bruno.token)).body.data as List).others)).toEqual([anna.id]);
  });

  it('senza allFriends si sfidano solo gli amici veri', async () => {
    const server = await start({ allFriends: false });
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    await call(server, 'POST', '/me/presence', bruno.token);
    expect((await call(server, 'POST', '/me/challenges', anna.token, { to: bruno.id })).body.error).toBe('Giocatore non trovato');
    await call(server, 'POST', '/me/friends/requests', anna.token, { to: bruno.id });
    await call(server, 'POST', `/me/friends/requests/${anna.id}/accept`, bruno.token);
    expect((await call(server, 'POST', '/me/challenges', anna.token, { to: bruno.id })).status).toBe(201);
  });
});
