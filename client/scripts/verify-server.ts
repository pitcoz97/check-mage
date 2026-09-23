/**
 * Verifica del contratto contro un server qualunque (Step 7).
 *
 * Pilota due account reali con lo stack del client — `src/api/adapter.ts`, `src/ws/connection.ts`,
 * `src/ws/dispatch.ts` e il reducer — e stampa un rapporto voce per voce di `docs/ASSUMPTIONS.md`.
 * Senza indirizzi usa il mock in-process, così lo strumento resta verificato a ogni giro.
 *
 * Uso:
 *   npm run verify:server
 *   npm run verify:server -- --http https://api.esempio.it --ws wss://api.esempio.it/ws [--slow] [--json]
 *   npm run verify:server -- --http … --ws … --users mario@x.it:Password1,luigi@x.it:Password1
 *
 * Il server deve essere tranquillo: i due client si accoppiano dalla coda, e un terzo giocatore in attesa fa
 * saltare la parte di partita (lo strumento se ne accorge e lo dice).
 */

import { pathToFileURL } from 'node:url';

import { startMockServer, type MockServerHandle } from '../mock-server/index';
import { interpretHttpResponse, normalizePasswordPolicy, normalizeSpellCatalog, normalizeWsTicket } from '../src/api/adapter';
import type { Color, Square } from '../src/game/model';
import { requiredChecks } from '../src/screens/Auth/credentialChecks';
import fallbackCatalog from '../src/spells/fallback.json';
import { createPacer, E2EClient, isType, type Pacer } from './e2e/client';
import { isMain, playTurn, tryMove, waitMyTurn } from './e2e/play';

const PASSWORD = 'Password1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------
// Rapporto
// ---------------------------------------------------------------------------------------------------

/**
 * `ok` = il server si comporta come il client assume. `diverso` = non si comporta così, e il client va corretto
 * (solo `adapter.ts` o `connection.ts`). `saltato` = non verificabile in automatico. `nota` = informazione utile
 * che non è un esito (per esempio una richiesta al backend che risulta applicata).
 */
export type CheckStatus = 'ok' | 'diverso' | 'saltato' | 'nota';

export interface CheckEntry {
  readonly ids: string;
  readonly what: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

class Ledger {
  readonly entries: CheckEntry[] = [];

  private add(status: CheckStatus, ids: string, what: string, detail = ''): void {
    this.entries.push({ ids, what, status, detail });
  }
  check(ids: string, what: string, condition: boolean, detail = ''): boolean {
    this.add(condition ? 'ok' : 'diverso', ids, what, detail);
    return condition;
  }
  skip(ids: string, what: string, why: string): void {
    this.add('saltato', ids, what, why);
  }
  note(ids: string, what: string, detail: string): void {
    this.add('nota', ids, what, detail);
  }
  failed(ids: string, what: string, error: unknown): void {
    this.add('diverso', ids, what, error instanceof Error ? error.message : String(error));
  }
  count(status: CheckStatus): number {
    return this.entries.filter((e) => e.status === status).length;
  }
}

interface Ctx {
  readonly ledger: Ledger;
  readonly pacer: Pacer;
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly slow: boolean;
  /** Il bersaglio è il mock avviato qui: alcuni controlli non hanno senso (limiti rilassati). */
  readonly againstMock: boolean;
  readonly users: readonly { email: string; password: string; username: string }[];
}

/** Una sezione non deve poter fermare le altre: un'eccezione diventa una voce `diverso`. */
async function section(ledger: Ledger, ids: string, what: string, run: () => Promise<void>): Promise<void> {
  await sectionValue(ledger, ids, what, run);
}

/** Come `section`, ma restituisce il risultato (`null` se la sezione è fallita). */
async function sectionValue<T>(ledger: Ledger, ids: string, what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    ledger.failed(ids, what, error);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------------------------------

function jsonOf(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function verifyRest(ctx: Ctx, client: E2EClient): Promise<void> {
  const { ledger } = ctx;

  const status = await client.raw('GET', '/status', { authorization: null });
  const statusBody = jsonOf(status.body);
  ledger.check(
    'A12',
    'ogni risposta REST è avvolta in {success, data?, error?}',
    statusBody !== null && 'success' in statusBody,
    `GET /status → ${status.status} ${status.body.slice(0, 120)}`,
  );

  const account = await client.me();
  ledger.check('A12', '/me restituisce il profilo dell’utente autenticato', account.email === client.email, `id ${account.id}, ELO ${account.elo}`);

  // B3: il refresh token non deve valere come access token.
  const refreshAsAccess = await client.raw('GET', '/me', { authorization: client.tokens?.refreshToken ?? '' });
  ledger.check('B3', 'il refresh token non è accettato come access token', refreshAsAccess.status === 401, `→ ${refreshAsAccess.status}`);

  const noToken = await client.raw('GET', '/me', { authorization: null });
  ledger.check('A12', '/me senza token è 401', noToken.status === 401, `→ ${noToken.status}`);

  const notFound = await client.raw('GET', '/rotta-inesistente', { authorization: null });
  const notFoundBody = jsonOf(notFound.body);
  ledger.check(
    'C4',
    '404 in JSON, non in HTML',
    notFound.status === 404 && notFoundBody !== null,
    `→ ${notFound.status} ${notFound.body.slice(0, 80)}`,
  );
  const wrongMethod = await client.raw('POST', '/status', { authorization: null, body: '{}' });
  ledger.check('C4', '405 in JSON sul metodo sbagliato', wrongMethod.status === 405 && jsonOf(wrongMethod.body) !== null, `→ ${wrongMethod.status}`);

  // C4: i testi d'errore REST devono essere riconosciuti dall'adapter, che non ha codici da leggere.
  const badLogin = await client.raw('POST', '/auth/login', {
    authorization: null,
    body: JSON.stringify({ email: client.email, password: 'password-sbagliata-1A' }),
  });
  const interpreted = interpretHttpResponse(badLogin.status, badLogin.body);
  ledger.check(
    'C4',
    'il testo d’errore di un login rifiutato è riconosciuto (nessun messaggio generico)',
    !interpreted.ok && interpreted.error.code === 'invalid_credentials',
    `→ ${badLogin.status} ${badLogin.body.slice(0, 100)}`,
  );

  const policyRes = await client.raw('GET', '/auth/password-policy', { authorization: null });
  const policy = normalizePasswordPolicy(jsonOf(policyRes.body)?.['data'] ?? jsonOf(policyRes.body));
  if (policy.ok) {
    // La regex dello username è RE2 di Go: qui si controlla che il client riesca a compilarla (ASSUMPTIONS C9).
    ledger.check(
      'C9',
      'la policy di registrazione è esposta e la sua regex compila anche in JavaScript',
      policy.warnings.length === 0,
      `${requiredChecks(policy.value).length} requisiti · ${policy.warnings.map((w) => w.code).join(' ') || 'nessun warning'}`,
    );
  } else {
    ledger.check('C9', 'GET /auth/password-policy risponde con una policy leggibile', false, `→ ${policyRes.status} ${policyRes.body.slice(0, 100)}`);
  }

  const profile = await client.profile(String(account.id));
  ledger.check('A12', '/users/{id} porta profilo e statistiche', profile.user.username === client.username, JSON.stringify(profile.stats));
  const games = await client.games(String(account.id));
  ledger.check('B10', '/users/{id}/games restituisce una lista (anche vuota)', Array.isArray(games), `${games.length} partite`);
}

async function verifyCatalog(ctx: Ctx, client: E2EClient): Promise<void> {
  const { ledger } = ctx;
  const raw = await client.raw('GET', '/spells', { authorization: null });
  const envelope = jsonOf(raw.body);
  const catalog = normalizeSpellCatalog(envelope?.['data'] ?? envelope);
  if (!ledger.check('C3, G10', 'GET /spells serve un catalogo che passa dallo schema del client', catalog.spells.length > 0, `→ ${raw.status}`)) return;
  ledger.check('C3', 'nessuna voce del catalogo viene scartata dall’adapter', catalog.warnings.length === 0, catalog.warnings.map((w) => w.detail ?? w.code).join(' | '));

  // Deriva fra il catalogo del server e la riserva locale: non è un errore, ma va saputo.
  const fallback = normalizeSpellCatalog(fallbackCatalog).spells;
  const drift = catalog.spells
    .map((spell) => {
      const local = fallback.find((f) => f.id === spell.id);
      if (local === undefined) return `${spell.id}: nuova`;
      if (local.manaCost !== spell.manaCost) return `${spell.id}: costo ${local.manaCost} → ${spell.manaCost}`;
      if (local.targetType !== spell.targetType) return `${spell.id}: bersaglio ${local.targetType} → ${spell.targetType}`;
      return null;
    })
    .filter((line) => line !== null);
  const missing = fallback.filter((f) => !catalog.spells.some((s) => s.id === f.id)).map((f) => `${f.id}: sparita`);
  const differences = [...drift, ...missing];
  if (differences.length === 0) ledger.note('G10', 'la riserva fallback.json è allineata al catalogo del server', `${catalog.spells.length} magie`);
  else ledger.note('G10', 'la riserva fallback.json va riallineata', differences.join(' | '));
}

/** Prova ad aprire davvero il WebSocket con un ticket: `true` se il server completa l'handshake. */
async function handshake(ctx: Ctx, ticket: string): Promise<{ opened: boolean; socket: WebSocket | null }> {
  // L'upgrade è limitato a 1/s per IP: senza distanza il quarto handshake della suite riceverebbe 429.
  await ctx.pacer.ws();
  const wsUrl = ctx.wsUrl;
  return new Promise((resolve) => {
    const url = new URL(wsUrl);
    url.searchParams.set('ticket', ticket);
    const socket = new WebSocket(url);
    const done = (opened: boolean) => {
      clearTimeout(timer);
      resolve({ opened, socket: opened ? socket : null });
    };
    const timer = setTimeout(() => done(false), 5_000);
    socket.addEventListener('open', () => done(true), { once: true });
    socket.addEventListener('error', () => done(false), { once: true });
    socket.addEventListener('close', () => done(false), { once: true });
  });
}

async function verifyTickets(ctx: Ctx, client: E2EClient): Promise<void> {
  const { ledger } = ctx;
  const res = await client.raw('GET', '/ws/ticket');
  const ticket = normalizeWsTicket(jsonOf(res.body)?.['data'] ?? jsonOf(res.body));
  if (!ledger.check('P0-1', 'GET /ws/ticket restituisce un ticket a vita breve', ticket.ok, `→ ${res.status} ${res.body.slice(0, 120)}`)) return;
  if (!ticket.ok) return;
  ledger.note('P0-1', 'durata del ticket dichiarata dal server', `${ticket.value.expiresInSeconds}s`);

  const withoutToken = await client.raw('GET', '/ws/ticket', { authorization: null });
  ledger.check('P0-1', 'il ticket richiede il Bearer', withoutToken.status === 401, `→ ${withoutToken.status}`);

  const invented = await handshake(ctx, 'ticket-inventato');
  ledger.check('P0-1', 'un ticket inventato non apre il WebSocket', !invented.opened);
  invented.socket?.close();

  // Monouso: il primo handshake consuma il ticket, il secondo con lo stesso deve fallire.
  const first = await handshake(ctx, ticket.value.ticket);
  const second = await handshake(ctx, ticket.value.ticket);
  ledger.check('P0-1', 'il ticket vale una volta sola', first.opened && !second.opened, `primo ${first.opened ? 'aperto' : 'rifiutato'}, secondo ${second.opened ? 'aperto' : 'rifiutato'}`);
  first.socket?.close();
  second.socket?.close();
  // Le due aperture sono passate dalla coda: si lascia al server il tempo di ripulirla prima della partita.
  await sleep(300);
}

// ---------------------------------------------------------------------------------------------------
// Partita fra due client reali
// ---------------------------------------------------------------------------------------------------

/** Attende che i due client siano nella stessa partita; `null` se il server ha accoppiato qualcun altro. */
async function pairUp(a: E2EClient, b: E2EClient): Promise<{ white: E2EClient; black: E2EClient } | null> {
  await a.connect();
  await sleep(200);
  await b.connect();
  await a.event(0, isType('game_state'), 'primo game_state di A');
  await b.event(0, isType('game_state'), 'primo game_state di B');
  const players = a.state?.players;
  const ids = players === null || players === undefined ? [] : [players.white.id, players.black.id];
  const ours = [String(a.account?.id), String(b.account?.id)];
  if (!ours.every((id) => ids.includes(id))) return null;
  return a.color === 'white' ? { white: a, black: b } : { white: b, black: a };
}

async function verifyMatchStart(ctx: Ctx, white: E2EClient, black: E2EClient): Promise<void> {
  const { ledger } = ctx;
  ledger.check(
    'C1, P0-5',
    'il colore si ricava da white_player/black_player, non si deduce',
    white.color === 'white' && black.color === 'black',
    `${white.username}=${String(white.color)}, ${black.username}=${String(black.color)}`,
  );
  ledger.check(
    'G4',
    'all’avvio arrivano game_state e hand, non un game_start',
    white.events.some(isType('game_state')) && white.events.some(isType('hand')) && !white.events.some((e) => e.type.startsWith('game_start')),
    white.events
      .slice(0, 4)
      .map((e) => e.type)
      .join(' → '),
  );
  ledger.check('G2', 'la mano privata porta solo spell_id, senza id d’istanza', white.hand.length > 0 && white.hand.every((c) => c.spellId !== ''), `${white.hand.length} carte`);
  ledger.check('P2-9', 'game_state porta il time control', white.state?.timeControl !== null, JSON.stringify(white.state?.timeControl));
  ledger.check(
    'R3, R4',
    'la fase iniziale avanza da sola fino a una in cui il giocatore può agire',
    white.phase === 'main1' || white.phase === 'move',
    `fase ${String(white.phase)}, turno ${String(white.state?.turnNumber)}, mana ${white.myMana}`,
  );
  ledger.check(
    'A13',
    'il primo turno è del bianco',
    white.state?.activePlayer === 'white' && white.state.turnNumber === 1,
    `attivo ${String(white.state?.activePlayer)}`,
  );
}

async function verifyRefusals(ctx: Ctx, white: E2EClient, black: E2EClient): Promise<void> {
  const { ledger } = ctx;
  const outOfTurn = black.send({ type: 'move', move: 'e7e5' });
  const notYourTurn = await black.event(outOfTurn, isType('error'), 'rifiuto fuori turno');
  ledger.check('G6', 'una mossa fuori turno è rifiutata con not_your_turn', notYourTurn.error.code === 'not_your_turn', String(notYourTurn.error.code));

  await waitMyTurn(white);
  if (isMain(white)) {
    const inMain = white.send({ type: 'move', move: 'e2e4' });
    const wrongPhase = await white.event(inMain, isType('error'), 'mossa fuori fase');
    ledger.check(
      'G6, A15',
      'una mossa fuori fase porta il codice e la fase nei details',
      wrongPhase.error.code === 'wrong_phase' && wrongPhase.error.phase !== null,
      `${String(wrongPhase.error.code)} phase=${String(wrongPhase.error.phase)}`,
    );
    white.send({ type: 'pass_phase' });
    await white.until(() => white.phase === 'move' || !white.isMyTurn, 'fase move');
  }

  if (white.phase === 'move') {
    const illegal = white.send({ type: 'move', move: 'e2e5' });
    const error = await white.event(illegal, isType('error'), 'mossa illegale');
    ledger.check(
      'G6',
      'una mossa illegale porta illegal_move e la mossa nei details',
      error.error.code === 'illegal_move',
      `${String(error.error.code)} move=e2e5`,
    );
    const pass = white.send({ type: 'pass_phase' });
    const noPass = await white.event(pass, isType('error'), 'pass in fase move');
    ledger.check('G6', 'non si può passare la fase di mossa', noPass.error.code === 'wrong_phase', String(noPass.error.code));
  } else {
    ledger.skip('G6', 'mossa illegale e pass in fase move', `il server non si è fermato in move (fase ${String(white.phase)})`);
  }
}

/** Cadenza di `timer_update`: il rilevamento del socket morto a 5s (C10) si regge su ~1 evento al secondo. */
async function verifyTimerCadence(ctx: Ctx, client: E2EClient): Promise<void> {
  const from = client.events.length;
  await sleep(3_500);
  const ticks = client.events.slice(from).filter(isType('timer_update')).length;
  ctx.ledger.check('C10', 'il server manda timer_update circa una volta al secondo', ticks >= 2, `${ticks} in 3,5s`);
}

async function verifyCasting(ctx: Ctx, client: E2EClient): Promise<void> {
  const { ledger } = ctx;
  const catalog = (await client.catalog()).spells;
  const kinds = new Set<string>();
  let casts = 0;
  let manaChecked = false;

  const pawnOn = (file: string, owner: Color): Square | null => {
    const rows = (client.state?.fen.split(' ')[0] ?? '').split('/');
    const pawn = owner === 'white' ? 'P' : 'p';
    for (let r = 0; r < 8; r++) {
      let col = 0;
      for (const ch of rows[r] ?? '') {
        if (/\d/.test(ch)) col += Number(ch);
        else {
          if (ch === pawn && String.fromCharCode(97 + col) === file) return `${file}${8 - r}` as Square;
          col++;
        }
      }
    }
    return null;
  };

  const inMain = async (c: E2EClient): Promise<void> => {
    const color = c.color as Color;
    if (!manaChecked) {
      const expensive = c.hand.find((card) => (catalog.find((s) => s.id === card.spellId)?.manaCost ?? 0) > c.myMana);
      if (expensive !== undefined) {
        const from = c.send({ type: 'cast_spell', card: expensive, targets: [] });
        const error = await c.event(from, isType('error'), 'rifiuto per mana insufficiente');
        ledger.check(
          'G6',
          'un cast senza mana è rifiutato con insufficient_mana e i numeri nei details',
          error.error.code === 'insufficient_mana' && error.error.needed !== null,
          `${String(error.error.code)} needed=${String(error.error.needed)} available=${String(error.error.available)}`,
        );
        manaChecked = true;
      }
    }
    const tried = new Set<string>();
    for (;;) {
      if (c.gameOver !== null || !c.isMyTurn || !isMain(c)) return;
      const card = c.hand.find((h) => {
        const spell = catalog.find((s) => s.id === h.spellId);
        return spell !== undefined && !tried.has(h.spellId) && spell.manaCost <= c.myMana && spell.targetType !== 'piece_move';
      });
      if (card === undefined) return;
      tried.add(card.spellId);
      const spell = catalog.find((s) => s.id === card.spellId);
      if (spell === undefined) return;
      const targets =
        spell.targetType === 'none' ? [] : spell.targetType === 'enemy_piece' ? [pawnOn('h', color === 'white' ? 'black' : 'white')] : [pawnOn('a', color)];
      if (targets.some((t) => t === null)) continue;
      const from = c.send({ type: 'cast_spell', card, targets: targets as Square[] });
      const outcome = await c.event(
        from,
        (e): e is Extract<typeof e, { type: 'spell_cast' | 'error' }> => (e.type === 'spell_cast' && e.player === color) || e.type === 'error',
        `esito cast ${spell.id}`,
      );
      if (outcome.type !== 'spell_cast') continue;
      casts++;
      for (const effect of outcome.effects) kinds.add(effect.kind);
    }
  };

  await playTurn(client, { inMain });
  ledger.check('G8', 'i cast riusciti dichiarano gli effetti applicati', casts === 0 || kinds.size > 0, `${casts} cast, effetti: ${[...kinds].join(', ') || '—'}`);
  if (casts === 0) ledger.skip('G8', 'copertura dei kind di effetto', 'nessuna carta castabile nelle mani pescate');
  else ledger.note('G8', 'kind di effetto visti in questa partita', [...kinds].sort().join(', '));
  if (!manaChecked) ledger.skip('G6', 'rifiuto per mana insufficiente', 'nessuna carta più cara del mana disponibile');
}

/**
 * C13 e C15: il turno si chiude con l'ultimo `pass_phase`, e lì il server non manda `game_state`. Restano quindi
 * indietro i turni residui degli effetti e la dimensione del mazzo avversario, finché non arriva uno stato nuovo.
 */
async function verifyRollover(ctx: Ctx, client: E2EClient): Promise<void> {
  const { ledger } = ctx;
  await waitMyTurn(client);
  while (client.isMyTurn && isMain(client) && client.phase !== 'move' && client.gameOver === null) {
    const phase = client.phase;
    client.send({ type: 'pass_phase' });
    await client.until(() => client.phase !== phase || !client.isMyTurn || client.gameOver !== null, `uscita da ${String(phase)}`);
  }
  if (!client.isMyTurn || client.phase !== 'move') {
    ledger.skip('C13', 'game_state alla chiusura del turno', `il turno non è arrivato alla mossa (fase ${String(client.phase)})`);
    return;
  }
  const turn = client.state?.turnNumber ?? 0;
  const move = client.pickMove(new Set());
  if (move === null || (await tryMove(client, move)) !== 'ok') {
    ledger.skip('C13', 'game_state alla chiusura del turno', 'nessuna mossa giocabile');
    return;
  }

  /**
   * La finestra da guardare comincia **dopo** il `game_state` della mossa e finisce quando il turno passa
   * all'avversario: lì il server decrementa gli effetti e fa pescare. Il turno può chiudersi da solo
   * (auto-avanzamento di main2, R4) oppure con un `pass_phase`: vanno bene entrambi.
   */
  const afterMove = client.events.findLastIndex(isType('game_state')) + 1;
  // `isMain` invece del confronto diretto: dopo la mossa la fase è cambiata, e TypeScript non lo sa.
  if (client.isMyTurn && isMain(client)) client.send({ type: 'pass_phase' });
  await client.until(() => !client.isMyTurn || client.gameOver !== null, 'chiusura del turno');
  await sleep(400);
  const state = client.events.slice(afterMove).some(isType('game_state'));
  if (state) ledger.note('C13, C15, P2-14', 'il server manda game_state anche alla chiusura del turno: le note su remaining_turns e deck_size si possono togliere', `turno ${turn}`);
  else ledger.check('C13, C15', 'alla chiusura del turno non arriva game_state: effetti e mazzo avversario restano indietro', true, `turno ${turn}`);
}

async function verifySnapshot(ctx: Ctx, client: E2EClient): Promise<void> {
  const diff = await client.verifySnapshot();
  ctx.ledger.check(
    'G5',
    'alla riconnessione il server rimanda lo stato completo, uguale a quello del reducer',
    diff.length === 0,
    diff.join(' | ') || 'nessuna differenza',
  );
  ctx.ledger.check(
    'G5',
    'il game_state del rientro è marcato reconnected',
    client.events.filter(isType('game_state')).at(-1)?.state.reconnected === true,
    '',
  );
}

async function verifyDraw(ctx: Ctx, offerer: E2EClient, receiver: E2EClient): Promise<void> {
  const { ledger } = ctx;
  let from = offerer.send({ type: 'draw_offer' });
  await offerer.event(from, isType('draw_offer_sent'), 'conferma dell’offerta');
  const seen = await receiver.event(0, isType('draw_offer'), 'offerta ricevuta');
  ledger.check('A17', 'l’offerta di patta arriva all’avversario con il nome di chi la fa', seen.from !== '', seen.from);

  receiver.send({ type: 'draw_declined' });
  const declined = await offerer.event(from, isType('draw_declined'), 'rifiuto della patta');
  ledger.check('A17', 'il rifiuto torna a chi ha offerto, con il motivo', declined.reason === 'declined', String(declined.reason));

  // Decadenza: l'offerta cade quando muove chi l'ha ricevuta, quindi deve essere il suo turno.
  await playTurn(offerer);
  from = offerer.send({ type: 'draw_offer' });
  await offerer.event(from, isType('draw_offer_sent'), 'seconda offerta');
  await playTurn(receiver);
  const lapsed = await offerer.event(from, isType('draw_declined'), 'decadenza dopo la mossa');
  ledger.check('A17', 'l’offerta decade quando l’avversario muove (reason move_played)', lapsed.reason === 'move_played', String(lapsed.reason));
}

async function verifyReplaced(ctx: Ctx, client: E2EClient): Promise<E2EClient> {
  const { ledger } = ctx;
  const twin = client.twin();
  await twin.connect();
  await client.until(() => client.replaced, 'chiusura della connessione sostituita');
  ledger.check('B2', 'una seconda connessione dello stesso utente sostituisce la prima (4001)', client.replaced, client.statusHistory.join(' → '));
  const error = client.events.filter(isType('error')).at(-1);
  ledger.check('B2', 'la connessione sostituita riceve replaced_by_new_connection prima della chiusura', error?.error.code === 'replaced_by_new_connection', String(error?.error.code));
  await twin.event(0, isType('game_state'), 'stato sulla connessione nuova');
  ledger.check('B2', 'la connessione nuova riprende la partita', twin.state !== null, `fase ${String(twin.phase)}`);
  return twin;
}

async function verifyEnd(ctx: Ctx, resigning: E2EClient, other: E2EClient): Promise<void> {
  const { ledger } = ctx;
  resigning.send({ type: 'resign' });
  await resigning.until(() => resigning.gameOver !== null, 'game_over dopo la resa');
  await other.until(() => other.gameOver !== null, 'game_over per l’avversario');
  const outcome = resigning.gameOver;
  ledger.check('B1', 'la resa chiude la partita con risultato, motivo e vincitore', outcome?.reason === 'resign' && outcome.winner !== null, JSON.stringify(outcome));

  const overIndex = resigning.events.findIndex(isType('game_over'));
  const lastState = resigning.events.slice(0, overIndex).filter(isType('game_state')).at(-1);
  ledger.check('B1', 'l’ultimo game_state prima della fine porta lo status terminale', lastState?.state.status === 'resigned', String(lastState?.state.status));

  const after = resigning.send({ type: 'pass_phase' });
  const error = await resigning.event(after, isType('error'), 'azione dopo la fine');
  ledger.check('B1', 'dopo la fine ogni azione è rifiutata con game_over', error.error.code === 'game_over', String(error.error.code));
}

// ---------------------------------------------------------------------------------------------------
// Controlli lenti (dietro --slow)
// ---------------------------------------------------------------------------------------------------

async function verifySlow(ctx: Ctx, client: E2EClient): Promise<void> {
  const { ledger } = ctx;
  // Heartbeat: il server manda ping ogni 54s e chiude a 60s di silenzio. Il pong è automatico nel WebSocket.
  await client.connect();
  await sleep(70_000);
  ledger.check('C10', 'il socket sopravvive oltre un minuto di silenzio (ping/pong del server)', client.connected, `stati: ${client.statusHistory.join(' → ')}`);
  await client.disconnect();

  // Rate limit auth per IP: dopo pochi tentativi ravvicinati deve arrivare un 429.
  if (ctx.againstMock) {
    ledger.skip('A12', 'rate limit su /auth', 'il mock in-process gira con limiti rilassati, per non strozzare la suite stessa');
    return;
  }
  const codes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const res = await client.raw('POST', '/auth/login', { authorization: null, body: JSON.stringify({ email: client.email, password: 'Sbagliata1' }) });
    codes.push(res.status);
  }
  ledger.check('A12', 'il rate limit su /auth scatta con tentativi ravvicinati', codes.includes(429), `stati: ${[...new Set(codes)].join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------------------------------

export interface VerifyOptions {
  readonly httpUrl?: string;
  readonly wsUrl?: string;
  readonly users?: readonly { email: string; password: string; username: string }[];
  readonly slow?: boolean;
}

export async function verifyServer(options: VerifyOptions = {}): Promise<CheckEntry[]> {
  const ledger = new Ledger();
  // Contro un server vero gli upgrade vanno distanziati (1/s per IP); contro il mock no, ha limiti rilassati.
  const pacer = createPacer(options.httpUrl === undefined ? {} : { wsSpacingMs: 1_200 });
  let mock: MockServerHandle | null = null;
  if (options.httpUrl === undefined) {
    mock = await startMockServer({ port: 0, quiet: true, rateLimits: { general: { rate: 200, burst: 400 }, auth: { rate: 100, burst: 100 }, ws: { rate: 100, burst: 100 }, wsMessages: { rate: 5, burst: 10 } } });
  }
  const httpUrl = options.httpUrl ?? (mock?.httpUrl as string);
  const wsUrl = options.wsUrl ?? (mock?.wsUrl as string);
  const stamp = Date.now().toString(36);
  const users =
    options.users ??
    (['a', 'b'] as const).map((suffix) => ({ username: `verify_${stamp}_${suffix}`, email: `verify_${stamp}_${suffix}@checkmage.test`, password: PASSWORD }));
  const ctx: Ctx = { ledger, pacer, httpUrl, wsUrl, slow: options.slow ?? false, againstMock: mock !== null, users };

  const clients = users.map((user) => new E2EClient(httpUrl, wsUrl, user.username, user.email, pacer));
  const [a, b] = clients as [E2EClient, E2EClient];
  /** Connessioni nate durante i controlli (per esempio la "seconda scheda"): vanno chiuse anche loro. */
  const extra: E2EClient[] = [];

  try {
    await section(ledger, 'A11, A12', 'registrazione e login dei due account di prova', async () => {
      for (const [index, client] of clients.entries()) {
        const user = users[index];
        if (user === undefined) return;
        if (options.users === undefined) await client.register(user.password);
        await client.login(user.password);
      }
      ledger.check('A11, A12', 'registrazione e login funzionano con username, email e password', a.tokens !== null && b.tokens !== null, `${a.username}, ${b.username}`);
      await a.refresh();
      ledger.check('A12', 'il refresh restituisce una coppia di token nuova e utilizzabile', (await a.me()).email === a.email, '');
    });

    await section(ledger, 'A12, C4', 'REST', () => verifyRest(ctx, a));
    await section(ledger, 'C3, G10', 'catalogo', () => verifyCatalog(ctx, a));
    await section(ledger, 'P0-1', 'ticket WebSocket', () => verifyTickets(ctx, a));

    // L'accoppiamento non deve poter far saltare il rapporto: se non riesce, il resto è già stato misurato.
    const pair = await sectionValue(ledger, 'C1', 'accoppiamento dei due client dalla coda', () => pairUp(a, b));
    if (pair === null) {
      ledger.skip('C1', 'controlli di partita', 'senza i due client nella stessa partita non si possono eseguire');
    } else {
      const { white, black } = pair;
      await section(ledger, 'C1, G2, G4', 'avvio della partita', () => verifyMatchStart(ctx, white, black));
      await section(ledger, 'G6', 'rifiuti delle azioni non valide', () => verifyRefusals(ctx, white, black));
      await section(ledger, 'C10', 'cadenza dei timer', () => verifyTimerCadence(ctx, white));
      await section(ledger, 'G8', 'lancio delle magie', () => verifyCasting(ctx, white));
      await section(ledger, 'C13', 'rollover del turno', () => verifyRollover(ctx, black));
      await section(ledger, 'G5', 'riconnessione e stato completo', () => verifySnapshot(ctx, white));
      await section(ledger, 'A17', 'offerta di patta', () => verifyDraw(ctx, white, black));
      let last = white;
      await section(ledger, 'B2', 'connessione sostituita', async () => {
        last = await verifyReplaced(ctx, white);
        extra.push(last);
      });
      await section(ledger, 'B1', 'fine partita', () => verifyEnd(ctx, last, black));
      await section(ledger, 'B10', 'storico e ELO dopo la partita', async () => {
        await sleep(500);
        const account = await a.me();
        const games = await a.games(String(account.id));
        ledger.note('B10', 'partita registrata e ELO aggiornato', `${games.length} partite in storico, ELO ${account.elo}`);
      });
    }

    if (ctx.slow) {
      // Il socket va lasciato solo: una seconda connessione dello stesso utente lo sostituirebbe.
      for (const client of [...clients, ...extra]) await client.disconnect().catch(() => undefined);
      await sleep(500);
      const solo = a.twin();
      extra.push(solo);
      await section(ledger, 'C10', 'controlli lenti', () => verifySlow(ctx, solo));
    } else ledger.skip('C10', 'heartbeat del server e rate limit per IP', 'richiedono --slow');

    ledger.skip('C11, C12', 'partita salvata e finestra di rientro', 'sono scelte del client, non comportamenti del server');
    ledger.skip('B12, B14', 'scudo sull’en passant e posizioni costruite', 'servono mazzi pilotati: restano coperte dal mock (room.test.ts)');

    // I warning dell'adapter sono il segnale più diretto di una divergenza dal contratto.
    const all = [...clients, ...extra];
    const warnings = [...new Set(all.flatMap((c) => c.warnings.map((w) => `${w.assumption}:${w.code}`)))];
    ledger.check('A15', 'l’adapter non ha incontrato payload inattesi', warnings.length === 0, warnings.join(' ') || 'nessun warning');
    const failures = all.flatMap((c) => c.failures);
    ledger.check('A15', 'nessun frame del server è rimasto indecifrabile', failures.length === 0, failures.map((f) => f.kind).join(' ') || 'nessuno');
  } finally {
    for (const client of [...clients, ...extra]) await client.disconnect().catch(() => undefined);
    await mock?.close();
  }
  return ledger.entries;
}

function parseArgs(argv: readonly string[]): VerifyOptions & { json: boolean } {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const users = value('users')
    ?.split(',')
    .map((pair) => {
      const [email = '', password = ''] = pair.split(':');
      return { email, password, username: email.split('@')[0] ?? email };
    });
  const http = value('http');
  const ws = value('ws');
  return {
    ...(http === undefined ? {} : { httpUrl: http.replace(/\/$/, '') }),
    ...(ws === undefined ? {} : { wsUrl: ws }),
    ...(users === undefined ? {} : { users }),
    slow: argv.includes('--slow'),
    json: argv.includes('--json'),
  };
}

const MARK: Record<CheckStatus, string> = { ok: '✔', diverso: '✘', saltato: '·', nota: 'i' };

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const { json, ...options } = parseArgs(process.argv.slice(2));
  if ((options.httpUrl === undefined) !== (options.wsUrl === undefined)) {
    process.stdout.write('Servono entrambi --http e --ws, oppure nessuno dei due (mock in-process).\n');
    process.exit(2);
  }
  const entries = await verifyServer(options);
  const out = process.stdout;
  if (json) out.write(`${JSON.stringify(entries, null, 2)}\n`);
  else {
    out.write(`\nVerifica del contratto — ${options.httpUrl ?? 'mock in-process'}\n\n`);
    for (const entry of entries) {
      out.write(`${MARK[entry.status]} ${entry.ids.padEnd(12)} ${entry.what}\n`);
      if (entry.detail !== '') out.write(`  ${' '.repeat(12)} ${entry.detail}\n`);
    }
  }
  const diverse = entries.filter((e) => e.status === 'diverso');
  // Con `--json` su stdout esce solo JSON: il riepilogo va sull'errore standard, così il file resta leggibile.
  const summary = process[json ? 'stderr' : 'stdout'];
  summary.write(
    `\n${entries.filter((e) => e.status === 'ok').length} verificate · ${diverse.length} divergenti · ` +
      `${entries.filter((e) => e.status === 'saltato').length} saltate · ${entries.filter((e) => e.status === 'nota').length} note\n`,
  );
  process.exit(diverse.length === 0 ? 0 : 1);
}
