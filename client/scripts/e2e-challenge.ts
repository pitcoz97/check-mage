/**
 * Prova end-to-end di amici, presenza, sfide dirette e amicizie vere (ASSUMPTIONS F1–F10, A1–A10) con lo stack del client: adapter,
 * connessione (`/ws?challenge=<id>`, chiusura 4003) e reducer. Senza indirizzi usa il mock in-process; con `--http` e
 * `--ws` gira contro un server vero (per esempio quello Go sulla VM), registrando due account di prova.
 *
 * Uso:
 *   npm run e2e:challenge
 *   npm run e2e:challenge -- --http http://localhost:8080 --ws ws://localhost:8080/ws
 */

import { pathToFileURL } from 'node:url';

import { startMockServer } from '../mock-server/index';
import { interpretHttpResponse, normalizeBlocks, normalizeChallenge, normalizeFriendList, normalizePresence, normalizeUserSearch } from '../src/api/adapter';
import type { BlockedUser, Challenge, Friend, FriendList, PresenceUpdate, UserSearchResult } from '../src/api/types';
import { createPacer, E2EClient, isType } from './e2e/client';

const PASSWORD = 'Password1';

class Report {
  readonly checks: string[] = [];
  readonly problems: string[] = [];
  expect(condition: boolean, label: string): void {
    (condition ? this.checks : this.problems).push(label);
  }
}

/** Una chiamata REST dell'amicizia, interpretata dall'adapter come fa il client. */
async function rest<T>(
  client: E2EClient,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  normalize: (data: unknown) => { ok: true; value: T } | { ok: false; issues: readonly string[] },
  body?: unknown,
): Promise<{ ok: true; value: T } | { ok: false; status: number; code: string | null }> {
  const res = await client.raw(method, path, body === undefined ? {} : { body: JSON.stringify(body) });
  const outcome = interpretHttpResponse(res.status, res.body);
  if (!outcome.ok) return { ok: false, status: res.status, code: outcome.error.code };
  const normalized = normalize(outcome.data);
  if (!normalized.ok) throw new Error(`${method} ${path}: ${normalized.issues.join('; ')}`);
  return { ok: true, value: normalized.value };
}

const accept = (data: unknown) => ({ ok: true as const, value: data });
const friends = (c: E2EClient) => rest<FriendList>(c, 'GET', '/me/friends', normalizeFriendList);
const presence = (c: E2EClient) => rest<PresenceUpdate>(c, 'POST', '/me/presence', normalizePresence);
const challenge = (c: E2EClient, to: string) => rest<Challenge>(c, 'POST', '/me/challenges', normalizeChallenge, { to: Number(to) });
const befriend = (c: E2EClient, to: string) => rest<FriendList>(c, 'POST', '/me/friends/requests', normalizeFriendList, { to: Number(to) });
const search = (c: E2EClient, q: string) => rest<readonly UserSearchResult[]>(c, 'GET', `/users/search?q=${encodeURIComponent(q)}`, normalizeUserSearch);
const block = (c: E2EClient, id: string) => rest<readonly BlockedUser[]>(c, 'POST', '/me/blocks', normalizeBlocks, { user_id: Number(id) });
/** Amici e altri giocatori: chi compare nella lista come sfidabile. */
const everyone = (list: FriendList): readonly Friend[] => [...list.friends, ...list.others];
const ids = (items: readonly Friend[]) => items.map((f) => f.id);

export async function runChallengeE2E(options: { httpUrl?: string; wsUrl?: string } = {}): Promise<Report> {
  const report = new Report();
  const mock = options.httpUrl === undefined ? await startMockServer({ port: 0, quiet: true, rateLimits: false }) : null;
  const httpUrl = options.httpUrl ?? mock?.httpUrl ?? '';
  const wsUrl = options.wsUrl ?? mock?.wsUrl ?? '';
  // Contro un server vero l'upgrade del WebSocket è limitato a 1/s per IP (burst 3).
  const pacer = createPacer({ wsSpacingMs: mock === null ? 1_100 : 0 });
  const suffix = Date.now().toString(36).slice(-6);
  const make = (name: string) => new E2EClient(httpUrl, wsUrl, `${name}_${suffix}`, `${name}_${suffix}@e2e.local`, pacer);
  const [anna, bruno, carlo] = [make('anna'), make('bruno'), make('carlo')];

  try {
    for (const c of [anna, bruno, carlo]) {
      await c.register(PASSWORD);
      await c.login(PASSWORD);
    }
    const annaId = anna.account?.id ?? '';
    const brunoId = bruno.account?.id ?? '';
    const carloId = carlo.account?.id ?? '';
    const eloBefore = (await anna.me()).elo;

    // Presenza e lista: bruno manda il segnale, anna lo vede online.
    await presence(bruno);
    const list = await friends(anna);
    const seen = list.ok ? everyone(list.value).find((f) => f.id === brunoId) : undefined;
    report.expect(seen?.status === 'online', `GET /me/friends: bruno online (${seen?.status ?? 'assente'})`);
    report.expect(list.ok && !everyone(list.value).some((f) => f.id === annaId), 'GET /me/friends: se stessi esclusi');

    // Amicizie vere: richiesta, badge, accetta; richiesta incrociata; ricerca; rimozione.
    const sent = await befriend(anna, brunoId);
    report.expect(sent.ok && ids(sent.value.outgoing).includes(brunoId), 'POST /me/friends/requests: richiesta inviata a bruno');
    const badge = await presence(bruno);
    report.expect(badge.ok && badge.value.friendRequests === 1, `POST /me/presence: friend_requests ${badge.ok ? badge.value.friendRequests : '?'}`);
    const accepted = await rest(bruno, 'POST', `/me/friends/requests/${annaId}/accept`, normalizeFriendList);
    report.expect(accepted.ok && ids(accepted.value.friends).includes(annaId), 'accept: anna e bruno sono amici');
    const twice = await befriend(anna, brunoId);
    report.expect(!twice.ok && twice.code === 'friend_already', `richiesta a un amico → ${twice.ok ? 'ok' : String(twice.code)}`);
    await befriend(carlo, annaId);
    const crossed = await befriend(anna, carloId);
    report.expect(crossed.ok && ids(crossed.value.friends).includes(carloId), 'richiesta incrociata: amicizia subito');
    const found = await search(anna, carlo.username.slice(0, 5));
    report.expect(found.ok && found.value.some((u) => u.id === carloId && u.relation === 'friend'), 'GET /users/search: carlo trovato come amico');
    const removed = await rest(anna, 'DELETE', `/me/friends/${carloId}`, normalizeFriendList);
    report.expect(removed.ok && !ids(removed.value.friends).includes(carloId), 'DELETE /me/friends/{id}: amicizia tolta');

    // Errori della sfida.
    const self = await challenge(anna, annaId);
    report.expect(!self.ok && self.code === 'challenge_self', `sfidare se stessi → ${self.ok ? 'ok' : String(self.code)}`);

    // Sfida rifiutata: anna aspetta sul socket, bruno rifiuta, anna riceve 4003.
    const first = await challenge(anna, brunoId);
    if (!first.ok) throw new Error(`POST /me/challenges: ${String(first.code)}`);
    const incoming = await presence(bruno);
    report.expect(incoming.ok && incoming.value.incoming.some((c) => c.id === first.value.id), 'POST /me/presence: la sfida arriva a bruno');
    await anna.connect(undefined, { challenge: first.value.id });
    const declined = await rest(bruno, 'DELETE', `/me/challenges/${first.value.id}`, accept);
    report.expect(declined.ok, 'DELETE /me/challenges/{id}: bruno rifiuta');
    await anna.until(() => anna.statusHistory.includes('challenge_closed'), 'chiusura 4003');
    report.expect(anna.statusHistory.at(-1) === 'challenge_closed', 'anna: chiusura 4003 senza riconnessione');
    await anna.disconnect();

    // Sfida accettata: tutti e due sul socket della sfida, la partita parte amichevole.
    const second = await challenge(anna, brunoId);
    if (!second.ok) throw new Error(`POST /me/challenges: ${String(second.code)}`);
    const annaFresh = anna.twin();
    await annaFresh.connect(undefined, { challenge: second.value.id });
    await bruno.connect(undefined, { challenge: second.value.id });
    await annaFresh.until(() => annaFresh.state !== null, 'game_state di anna');
    await bruno.until(() => bruno.state !== null, 'game_state di bruno');
    report.expect(annaFresh.state?.friendly === true && bruno.state?.friendly === true, 'game_state con friendly per tutti e due');
    const playing = await friends(anna);
    report.expect(playing.ok && everyone(playing.value).find((f) => f.id === brunoId)?.status === 'playing', 'GET /me/friends: bruno in partita');
    const busy = await challenge(anna, brunoId);
    report.expect(!busy.ok && busy.code === 'challenge_self_busy', `sfidare in partita → ${busy.ok ? 'ok' : String(busy.code)}`);

    // Fine: anna abbandona; nessun ELO cambia e la partita è salvata come amichevole.
    const from = annaFresh.send({ type: 'resign' });
    await annaFresh.event(from, isType('game_over'), 'game_over');
    await new Promise((resolve) => setTimeout(resolve, 300));
    report.expect((await anna.me()).elo === eloBefore, 'amichevole: ELO invariato');
    const games = await anna.games(annaId);
    report.expect(games[0]?.rated === false, `storico: amichevole (rated ${String(games[0]?.rated)})`);

    await annaFresh.disconnect();
    await bruno.disconnect();

    // Blocco: bruno blocca anna; niente richieste né sfide, nascosti a vicenda; poi sblocca.
    const blocked = await block(bruno, annaId);
    report.expect(blocked.ok && blocked.value.some((b) => b.id === annaId), 'POST /me/blocks: bruno blocca anna');
    const hidden = await friends(anna);
    report.expect(hidden.ok && !everyone(hidden.value).some((f) => f.id === brunoId), 'bloccato: anna non vede più bruno');
    const refused = await befriend(anna, brunoId);
    report.expect(!refused.ok && refused.code === 'challenge_player_not_found', `richiesta a chi ti ha bloccato → ${refused.ok ? 'ok' : String(refused.code)}`);
    await presence(bruno);
    const noChallenge = await challenge(anna, brunoId);
    report.expect(!noChallenge.ok && noChallenge.code === 'challenge_player_not_found', `sfida a chi ti ha bloccato → ${noChallenge.ok ? 'ok' : String(noChallenge.code)}`);
    const unblocked = await rest(bruno, 'DELETE', `/me/blocks/${annaId}`, normalizeBlocks);
    report.expect(unblocked.ok && unblocked.value.length === 0, 'DELETE /me/blocks/{id}: sbloccata');
  } catch (error) {
    report.problems.push(error instanceof Error ? error.message : String(error));
  } finally {
    await mock?.close();
  }
  return report;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const argv = process.argv.slice(2);
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const http = value('http');
  const ws = value('ws');
  if ((http === undefined) !== (ws === undefined)) {
    process.stdout.write('Servono entrambi --http e --ws, oppure nessuno dei due (mock in-process).\n');
    process.exit(2);
  }
  const report = await runChallengeE2E({ ...(http === undefined ? {} : { httpUrl: http.replace(/\/$/, '') }), ...(ws === undefined ? {} : { wsUrl: ws }) });
  for (const check of report.checks) process.stdout.write(`✔ ${check}\n`);
  for (const problem of report.problems) process.stdout.write(`✘ ${problem}\n`);
  process.stdout.write(`\n${report.checks.length} verificate · ${report.problems.length} problemi\n`);
  process.exit(report.problems.length === 0 ? 0 : 1);
}
