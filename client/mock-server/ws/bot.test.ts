import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import type { MockConfig } from '../config';
import { startMockServer, type MockServerHandle } from '../index';

/** Partite contro il bot (`game/bot.go`): avvio, colore, account nascosti, storico, patte. */

const servers: MockServerHandle[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets.length = 0;
  await Promise.all(servers.map((s) => s.close()));
  servers.length = 0;
});

async function start(overrides: Partial<MockConfig> = {}): Promise<MockServerHandle> {
  const server = await startMockServer({ port: 0, quiet: true, rateLimits: false, botDelayMs: 5, ...overrides });
  servers.push(server);
  return server;
}

type Body = { success: boolean; data?: unknown; error?: string };

async function get(server: MockServerHandle, path: string, token: string) {
  const res = await fetch(`${server.httpUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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

function connect(server: MockServerHandle, p: Player, query: string) {
  const ws = new WebSocket(`${server.wsUrl}?token=${p.token}&${query}`);
  sockets.push(ws);
  const frames: Frame[] = [];
  ws.on('message', (data) => frames.push(JSON.parse(data.toString()) as Frame));
  const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
  /** Il primo frame (già arrivato o futuro) che soddisfa `match`. */
  const until = (match: (f: Frame) => boolean) =>
    new Promise<Frame>((resolve) => {
      const found = frames.find(match);
      if (found !== undefined) return resolve(found);
      const onMessage = () => {
        const hit = frames.find(match);
        if (hit === undefined) return;
        ws.off('message', onMessage);
        resolve(hit);
      };
      ws.on('message', onMessage);
    });
  const send = (type: string, payload: Record<string, unknown> = {}) => ws.send(JSON.stringify({ type, payload }));
  return { ws, frames, closed, until, send };
}

const players = (state: Frame) => ({
  white: state.payload['white_player'] as Record<string, unknown>,
  black: state.payload['black_player'] as Record<string, unknown>,
});

const movesOf = (state: Frame) => ((state.payload['board'] as { moves: string[] }).moves ?? []).length;

describe('partite contro il bot', () => {
  it('col bianco scelto dal giocatore: amichevole, il bot ha il nero e il suo livello', async () => {
    const server = await start();
    const anna = await player(server, 'anna');
    const c = connect(server, anna, 'bot=intermediate&color=white');
    const state = await c.until((f) => f.type === 'game_state');
    expect(state.payload['friendly']).toBe(true);
    const { white, black } = players(state);
    expect(white).toEqual({ id: anna.id, username: 'anna' });
    expect(black).toMatchObject({ username: '#bot-intermediate', bot: 'intermediate' });
  });

  it('col nero il bot apre la partita', async () => {
    const server = await start();
    const anna = await player(server, 'anna');
    const c = connect(server, anna, 'bot=advanced&color=black');
    const first = await c.until((f) => f.type === 'game_state');
    expect(players(first).white).toMatchObject({ bot: 'advanced' });
    const afterMove = await c.until((f) => f.type === 'game_state' && movesOf(f) === 1);
    expect(afterMove.payload['active_player']).toBe('black');
  });

  it('un livello sconosciuto: bot_unavailable e chiusura 4004', async () => {
    const server = await start();
    const anna = await player(server, 'anna');
    const c = connect(server, anna, 'bot=grandmaster');
    expect(await c.closed).toBe(4004);
    expect(c.frames.filter((f) => f.type === 'error').map((f) => f.payload['code'])).toEqual(['bot_unavailable']);
  });

  it('gli account dei bot non compaiono in classifica, amici, ricerca e profilo', async () => {
    const server = await start();
    const [anna, bruno] = [await player(server, 'anna'), await player(server, 'bruno')];
    const c = connect(server, anna, 'bot=base&color=white');
    const state = await c.until((f) => f.type === 'game_state');
    const botId = players(state).black['id'] as number;

    const leaderboard = (await get(server, '/leaderboard', bruno.token)).body.data as { username: string }[];
    expect(leaderboard.map((e) => e.username)).not.toContain('#bot-base');
    const friends = (await get(server, '/me/friends', bruno.token)).body.data as { others: { id: number }[] };
    expect(friends.others.map((o) => o.id)).not.toContain(botId);
    expect((await get(server, '/users/search?q=bot', bruno.token)).body.data).toEqual([]);
    expect((await get(server, `/users/${botId}`, bruno.token)).status).toBe(404);
  });

  it('lo storico porta il livello del bot; niente ELO', async () => {
    const server = await start();
    const anna = await player(server, 'anna');
    const c = connect(server, anna, 'bot=base&color=white');
    await c.until((f) => f.type === 'game_state');
    c.send('resign');
    await c.until((f) => f.type === 'game_over');
    const games = (await get(server, `/users/${anna.id}/games`, anna.token)).body.data as Record<string, unknown>[];
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ rated: false, black_bot: 'base', result: '0-1' });
    expect(games[0]).not.toHaveProperty('white_bot');
    const me = (await get(server, `/users/${anna.id}`, anna.token)).body.data as { user: { elo: number } };
    expect(me.user.elo).toBe(1200);
  });

  it('il bot rifiuta le patte', async () => {
    const server = await start();
    const anna = await player(server, 'anna');
    const c = connect(server, anna, 'bot=base&color=white');
    await c.until((f) => f.type === 'game_state');
    c.send('draw_offer');
    const declined = await c.until((f) => f.type === 'draw_declined');
    expect(declined.payload['reason']).toBe('declined');
  });
});
