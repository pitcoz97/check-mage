/**
 * Prova end-to-end: avvia il mock (porting di chess-server, branch `fix/backend-requests`) in-process e gioca
 * partite reali con lo stack del client: adapter, connessione (ticket, riconnessione), dispatch e reducer.
 * Ogni scenario è quindi anche una sequenza reale di eventi per `applyServerEvent`.
 * Uso: `npm run mock:e2e [-- scenario ...]`.
 */

import { pathToFileURL } from 'node:url';

import { DEFAULT_CONFIG, type MockConfig } from '../mock-server/config';
import { startMockServer, type MockServerHandle } from '../mock-server/index';
import type { AdapterWarningCode } from '../src/api/adapter';
import type { Color, Square } from '../src/game/model';
import type { Spell } from '../src/spells/schema';
import type { DecodeFailure } from '../src/ws/protocol';
import { createPacer, E2EClient, isType, type Pacer } from './e2e/client';
import { isMain, leaveMainPhase, playTurn, tryMove, waitMyTurn } from './e2e/play';

const PASSWORD = 'Password1';

export interface ScenarioReport {
  name: string;
  ok: boolean;
  checks: string[];
  problems: string[];
  decodeFailures: number;
  warningCodes: string[];
}

class Report {
  readonly checks: string[] = [];
  readonly problems: string[] = [];
  expect(condition: boolean, label: string): void {
    (condition ? this.checks : this.problems).push(label);
  }
}

interface Ctx {
  server: MockServerHandle;
  slowClockServer: MockServerHandle;
  pacer: Pacer;
  report: Report;
}

/**
 * Casta le carte abbordabili con un solo bersaglio pezzo: un pedone nemico della colonna h o uno proprio della c (fuori dalle
 * mosse dello scenario). Restituisce i cast riusciti.
 */
function caster(catalog: readonly Spell[], counter: { casts: number; insufficientChecked: boolean }, report: Report) {
  return async (c: E2EClient): Promise<void> => {
    const color = c.color as Color;
    const pawnOn = (file: string, owner: Color): Square | null => {
      const rows = (c.state?.fen.split(' ')[0] ?? '').split('/');
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

    if (!counter.insufficientChecked) {
      const expensive = c.hand.find((card) => (catalog.find((s) => s.id === card.spellId)?.manaCost ?? 0) > c.myMana);
      if (expensive !== undefined) {
        const from = c.send({ type: 'cast_spell', card: expensive, targets: [], choice: null });
        const error = await c.event(from, isType('error'), 'rifiuto per mana insufficiente');
        report.expect(error.error.code === 'insufficient_mana', `cast troppo costoso → ${String(error.error.code)}`);
        counter.insufficientChecked = true;
      }
    }

    const tried = new Set<string>();
    for (;;) {
      if (c.gameOver !== null || !c.isMyTurn || !isMain(c)) return;
      const card = c.hand.find((h) => {
        const spell = catalog.find((s) => s.id === h.spellId);
        return spell !== undefined && !tried.has(h.spellId) && spell.manaCost <= c.myMana && spell.targets.length === 1 && spell.targets[0]?.type !== 'square';
      });
      if (card === undefined) return;
      tried.add(card.spellId);
      const spell = catalog.find((s) => s.id === card.spellId) as Spell;
      // Un solo bersaglio pezzo: un pedone nemico o proprio. Il server può rifiutarlo (filtri dello spec): conta come esito.
      const target = spell.targets[0]?.type === 'enemy_piece' ? [pawnOn('h', color === 'white' ? 'black' : 'white')] : [pawnOn('c', color)];
      if (target.some((t) => t === null)) continue;
      const from = c.send({ type: 'cast_spell', card, targets: target as Square[], choice: null });
      const outcome = await c.event(
        from,
        (e): e is Extract<typeof e, { type: 'spell_cast' | 'error' }> => (e.type === 'spell_cast' && e.player === color) || e.type === 'error',
        `esito cast ${spell.id}`,
      );
      if (outcome.type === 'spell_cast') counter.casts++;
    }
  };
}

async function newPlayer(server: MockServerHandle, pacer: Pacer, name: string): Promise<E2EClient> {
  const client = new E2EClient(server.httpUrl, server.wsUrl, name, `${name}@e2e.test`, pacer);
  await client.register(PASSWORD);
  await client.login(PASSWORD);
  return client;
}

/** Il colore arriva da `white_player`/`black_player` (P0-5), confrontati con l'id dell'account. */
async function ensureColor(ctx: Ctx, c: E2EClient, expected: Color): Promise<void> {
  await c.event(0, isType('game_state'), 'primo game_state');
  ctx.report.expect(c.color === expected, `${c.username}: colore ${String(c.color)} da white_player/black_player`);
}

/** L'ultimo `game_state` prima di `game_over` porta lo status finale (`game/room.go:562-564`). */
function finalStatus(c: E2EClient): string | null {
  const over = c.events.findIndex((e) => e.type === 'game_over');
  const before = c.events.slice(0, over < 0 ? c.events.length : over).filter(isType('game_state')).at(-1);
  return before?.state.status ?? null;
}

/** Il reducer, evento dopo evento, deve arrivare allo stesso stato che il server ricostruisce al rientro. */
async function expectSnapshot(ctx: Ctx, c: E2EClient, label: string): Promise<void> {
  const diff = await c.verifySnapshot();
  ctx.report.expect(diff.length === 0, `reducer coerente col server (${label})${diff.length === 0 ? '' : ': ' + diff.join(' | ')}`);
}

async function resignAndWait(c: E2EClient): Promise<void> {
  if (c.gameOver !== null) return;
  c.send({ type: 'resign' });
  await c.until(() => c.gameOver !== null, 'game_over dopo la resa');
}

function unexpectedWarnings(clients: E2EClient[], allowed: readonly AdapterWarningCode[] = []): string[] {
  return [...new Set(clients.flatMap((c) => c.warnings.map((w) => w.code)))].filter((code) => !allowed.includes(code));
}

// ---------------------------------------------------------------------------------------------------
// Scenari
// ---------------------------------------------------------------------------------------------------

type Scenario = (ctx: Ctx) => Promise<E2EClient[]>;

const SCENARIOS: Record<string, Scenario> = {
  /** Due client reali: auth completa, rifiuti, magie, matto dell'imbecille, ELO e storico. */
  async pvp(ctx) {
    const { server, pacer, report } = ctx;
    const white = await newPlayer(server, pacer, `mario`);
    const black = await newPlayer(server, pacer, `luigi`);
    report.expect(white.account?.elo === 1200, 'login: ELO iniziale 1200');
    await white.refresh();
    report.expect((await white.me()).email === white.email, 'refresh del token e /me con il token nuovo');
    const catalog = await white.catalog();
    report.expect(catalog.spells.length === 20, `catalogo: ${catalog.spells.length} magie da ${catalog.source}`);
    report.expect(catalog.source === 'server', 'catalogo da GET /spells');

    await white.connect('pvp');
    await black.connect('pvp');
    await ensureColor(ctx, white, 'white');
    await ensureColor(ctx, black, 'black');
    await white.event(0, isType('hand'), 'hand privata');
    report.expect(white.hand.length === 4 && black.hand.length === 4, 'mani iniziali da 4');
    const tc = white.state?.timeControl;
    report.expect(tc?.baseMs === 600_000 && tc.incrementMs === 5_000, `time_control ${JSON.stringify(tc)}`);

    // Rifiuti richiesti.
    const fromBlack = black.send({ type: 'move', move: 'e7e5' });
    report.expect((await black.event(fromBlack, isType('error'), 'mossa fuori turno')).error.code === 'not_your_turn', 'mossa fuori turno → not_your_turn');

    const counter = { casts: 0, insufficientChecked: false };
    const inMain = caster(catalog.spells, counter, report);
    await waitMyTurn(white);
    await leaveMainPhase(white, { inMain });
    await white.until(() => white.phase === 'move', 'move del bianco');
    report.expect((await white.event(white.send({ type: 'move', move: 'e2e5' }), isType('error'), 'mossa illegale')).error.code === 'illegal_move', 'mossa illegale → illegal_move');
    report.expect((await white.event(white.send({ type: 'pass_phase' }), isType('error'), 'pass in move')).error.code === 'wrong_phase', 'pass_phase in move → wrong_phase');
    report.expect((await tryMove(white, 'a2a3')) === 'ok', 'mossa legale accettata dopo i rifiuti');
    await leaveMainPhase(white, { inMain });

    const whiteMoves = ['b2b3', 'f2f3', 'g2g4'];
    const blackMoves = ['a7a6', 'b7b6', 'e7e5', 'd8h4'];
    for (let i = 0; i < blackMoves.length && white.gameOver === null; i++) {
      await playTurn(black, { move: blackMoves[i] as string, inMain });
      if (i === 1 && white.gameOver === null) {
        await waitMyTurn(white);
        await expectSnapshot(ctx, white, 'pvp, dopo i primi cast');
      }
      const move = whiteMoves[i];
      if (move !== undefined && white.gameOver === null) await playTurn(white, { move, inMain });
    }
    await white.until(() => white.gameOver !== null && black.gameOver !== null, 'game_over su entrambi');
    report.expect(counter.casts > 0, `magie accettate: ${counter.casts}`);
    report.expect(counter.insufficientChecked, 'rifiuto per mana insufficiente verificato');
    const over = white.gameOver;
    report.expect(over?.result === '0-1' && over.reason === 'checkmate' && over.winner === black.username, `game_over ${over?.result} ${over?.reason} ${over?.winner}`);
    report.expect(finalStatus(white) === 'checkmate', `game_state finale prima di game_over: ${String(finalStatus(white))}`);
    const late = await white.event(white.send({ type: 'resign' }), isType('error'), 'azione dopo la fine');
    report.expect(late.error.code === 'game_over', `azione dopo la fine → ${String(late.error.code)}`);

    await white.disconnect();
    await black.disconnect();
    const id = white.account?.id ?? '';
    const profile = await white.profile(id);
    const elo = (await white.me()).elo;
    report.expect(profile.stats.losses === 1 && elo < 1200, `ELO e statistiche aggiornati (${elo})`);
    const games = await white.games(id);
    report.expect(games.length === 1 && games[0]?.timeControl === '10+5', `storico partite con time_control ${String(games[0]?.timeControl)}`);
    const unexpected = unexpectedWarnings([white, black]);
    report.expect(unexpected.length === 0 && white.failures.length + black.failures.length === 0, `nessun warning inatteso né decode failure ${unexpected.join(',')}`);
    return [white, black];
  },

  /** Contro bot: matto del barbiere, con disconnessione e rientro del client a metà partita (G5). */
  async checkmate(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `anna`);
    await c.connect('checkmate');
    await ensureColor(ctx, c, 'white');
    await c.event(0, isType('hand'), 'hand');
    await playTurn(c, {
      move: 'e2e4',
      afterMove: async () => {
        const handBefore = c.hand.map((h) => h.spellId).sort();
        const handIds = c.hand.map((h) => h.instanceId);
        await c.disconnect();
        const from = c.events.length;
        await c.connect();
        const resumed = await c.event(from, isType('game_state'), 'game_state al rientro');
        const hand = await c.event(from, isType('hand'), 'hand al rientro');
        ctx.report.expect(resumed.state.reconnected && resumed.state.moves.some((m) => m.kind === 'move' && m.uci === 'e2e4'), 'G5: game_state con reconnected e mosse');
        ctx.report.expect(c.hand.every((h, i) => h.instanceId === handIds[i]), 'mano riconciliata: stessi id d’istanza (C5)');
        ctx.report.expect(JSON.stringify(hand.hand.cards.map((h) => h.spellId).sort()) === JSON.stringify(handBefore), 'G5: mano ripristinata');
      },
    });
    for (const move of ['d1h5', 'f1c4', 'h5f7']) await playTurn(c, { move });
    await c.until(() => c.gameOver !== null, 'game_over');
    ctx.report.expect(c.gameOver?.reason === 'checkmate' && c.gameOver.winner === c.username, `matto: ${c.gameOver?.reason}`);
    ctx.report.expect(unexpectedWarnings([c]).length === 0 && c.failures.length === 0, 'nessun warning inatteso né decode failure');
    await c.disconnect();
    return [c];
  },

  /** Il "server" si riavvia: il socket si chiude, il client rientra e la partita prosegue. */
  async restart(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `bea`);
    await c.connect('restart');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.until(() => !c.connected, 'chiusura del socket per riavvio');
    const from = c.events.length;
    const resumed = await c.event(from, isType('game_state'), 'game_state dopo la riconnessione automatica');
    ctx.report.expect(resumed.state.reconnected, 'rientro dopo il riavvio con reconnected: true');
    ctx.report.expect(c.statusHistory.includes('reconnecting'), 'riconnessione automatica con backoff, senza intervento');
    await playTurn(c);
    ctx.report.expect(c.gameOver === null, 'la partita prosegue dopo il riavvio');
    await resignAndWait(c);
    await c.disconnect();
    return [c];
  },

  /** Frame malformati e type sconosciuti intercalati a una partita valida. */
  async hostile(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `carla`);
    await c.connect('hostile');
    await ensureColor(ctx, c, 'white');
    for (let turn = 0; turn < 3 && c.gameOver === null; turn++) await playTurn(c);
    await resignAndWait(c);
    const kinds = new Set(c.failures.map((f) => f.kind));
    const expected: DecodeFailure['kind'][] = ['invalid_json', 'not_an_envelope', 'unknown_type', 'malformed_payload'];
    ctx.report.expect(c.problems.length === 0, 'l’adapter non ha mai lanciato eccezioni');
    ctx.report.expect(expected.every((k) => kinds.has(k)), `failure gestiti: ${[...kinds].join(', ')}`);
    ctx.report.expect(c.gameOver?.reason === 'resign', 'partita conclusa nonostante il rumore');
    await c.disconnect();
    return [c];
  },

  /** Il bot casta tutti i kind di effetto del catalogo. */
  async spells(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `dario`);
    await c.connect('spells');
    await ensureColor(ctx, c, 'white');
    const wanted = ['destroy_piece', 'freeze_piece', 'shield_piece', 'gain_mana', 'move_piece', 'summon_pawn'];
    const seen = () => new Set<string>(c.events.filter(isType('spell_cast')).flatMap((e) => e.effects.map((x) => x.kind)));
    for (let turn = 0; turn < 6 && c.gameOver === null && !wanted.every((k) => seen().has(k)); turn++) await playTurn(c);
    await c.until(() => wanted.every((k) => seen().has(k)) || c.gameOver !== null, 'tutti gli effetti', 10_000).catch(() => undefined);
    ctx.report.expect(wanted.every((k) => seen().has(k)), `effetti visti: ${[...seen()].join(', ')}`);
    if (c.gameOver === null) {
      await waitMyTurn(c);
      await expectSnapshot(ctx, c, 'spells, dopo tutti gli effetti');
    }
    ctx.report.expect(
      c.events.some((e) => e.type === 'game_state' && e.state.activeEffects.some((s) => s.effects.some((x) => x.sourceSpellId === 'frost'))),
      'active_effects con source_spell_id',
    );
    await resignAndWait(c);
    ctx.report.expect(unexpectedWarnings([c]).length === 0 && c.failures.length === 0, 'nessun warning inatteso né decode failure');
    await c.disconnect();
    return [c];
  },

  /** Patta: offerta del bot rifiutata, prima offerta del client rifiutata, seconda accettata. */
  async draw(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `elena`);
    await c.connect('draw');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.event(0, isType('draw_offer'), 'draw_offer dal bot');
    c.send({ type: 'draw_declined' });
    const from = c.send({ type: 'draw_offer' });
    await c.event(from, isType('draw_offer_sent'), 'draw_offer_sent');
    const declined = await c.event(from, isType('draw_declined'), 'rifiuto del bot');
    ctx.report.expect(declined.reason === 'declined', `draw_declined con reason ${declined.reason}`);
    c.send({ type: 'draw_offer' });
    await c.until(() => c.gameOver !== null, 'game_over');
    ctx.report.expect(c.gameOver?.reason === 'agreement' && c.gameOver.result === '1/2-1/2' && c.gameOver.winner === null, 'patta per accordo senza vincitore');
    ctx.report.expect(finalStatus(c) === 'draw', `status finale ${String(finalStatus(c))}`);
    await c.disconnect();
    return [c];
  },

  async abandon(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `fabio`);
    await c.connect('abandon');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.event(0, isType('opponent_disconnected'), 'opponent_disconnected');
    await c.until(() => c.gameOver !== null, 'game_over per abbandono', 15_000);
    ctx.report.expect(c.gameOver?.reason === 'abandonment' && c.gameOver.winner === c.username, `abbandono: ${c.gameOver?.reason}`);
    ctx.report.expect(finalStatus(c) === 'abandoned', `status finale ${String(finalStatus(c))}`);
    await c.disconnect();
    return [c];
  },

  async reconnect(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `gina`);
    await c.connect('reconnect');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.event(0, isType('opponent_disconnected'), 'opponent_disconnected');
    await c.event(0, isType('opponent_reconnected'), 'opponent_reconnected', 10_000);
    await playTurn(c);
    ctx.report.expect(c.gameOver === null, 'nessuna vittoria per abbandono: il bot è rientrato');
    await resignAndWait(c);
    await c.disconnect();
    return [c];
  },

  async timeout(ctx) {
    const c = await newPlayer(ctx.slowClockServer, ctx.pacer, `hugo`);
    await c.connect('timeout');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.until(() => c.gameOver !== null, 'game_over per tempo', 15_000);
    ctx.report.expect(c.gameOver?.reason === 'timeout' && c.gameOver.winner === c.username, `tempo: ${c.gameOver?.reason}`);
    ctx.report.expect(finalStatus(c) === 'timeout', `status finale ${String(finalStatus(c))}`);
    const update = c.events.filter(isType('timer_update')).at(-1);
    ctx.report.expect(update?.turn === 'black', 'timer_update.turn è il giocatore attivo');
    await c.disconnect();
    return [c];
  },

  /**
   * Seconda connessione dello stesso utente (B2, B10): la vecchia riceve `replaced_by_new_connection` e la chiusura
   * 4001, la nuova prosegue la partita e non scatta l'abbandono. Vale anche in coda.
   */
  async replaced(ctx) {
    const { report } = ctx;
    const queued = await newPlayer(ctx.server, ctx.pacer, 'ivo');
    await queued.connect('pvp');
    const queuedTwin = queued.twin();
    await queuedTwin.connect('pvp');
    const kicked = await queued.event(0, isType('error'), 'errore alla connessione in coda sostituita');
    await queued.until(() => !queued.connected, 'chiusura della connessione in coda');
    report.expect(kicked.error.code === 'replaced_by_new_connection' && queued.replaced, `coda: ${String(kicked.error.code)}, connessione sostituita`);
    await queuedTwin.disconnect();

    const first = await newPlayer(ctx.server, ctx.pacer, 'lea');
    await first.connect('checkmate');
    await ensureColor(ctx, first, 'white');
    await playTurn(first, { move: 'e2e4' });
    const second = first.twin();
    await second.connect();
    const resumed = await second.event(0, isType('game_state'), 'game_state sulla nuova connessione');
    const replaced = await first.event(0, isType('error'), 'errore sulla connessione sostituita');
    await first.until(() => !first.connected, 'chiusura della connessione sostituita');
    report.expect(resumed.state.reconnected && second.color === 'white', 'la nuova connessione riprende la partita');
    report.expect(replaced.error.code === 'replaced_by_new_connection' && first.replaced, `partita: ${String(replaced.error.code)}, connessione sostituita`);
    await playTurn(second, { move: 'd1h5' });
    await new Promise((resolve) => setTimeout(resolve, 3_500)); // oltre il timeout di riconnessione del mock e2e
    report.expect(second.gameOver === null, 'nessuna sconfitta per abbandono dopo la chiusura della connessione vecchia');
    report.expect(first.replaced && first.statusHistory.at(-1) === 'replaced', 'la connessione sostituita non si riconnette da sola');
    await resignAndWait(second);
    report.expect(unexpectedWarnings([first, second]).length === 0 && first.failures.length + second.failures.length === 0, 'nessun warning inatteso né decode failure');
    await second.disconnect();
    return [first, second];
  },
};

export const E2E_SCENARIOS = Object.keys(SCENARIOS);

/**
 * Limiti larghi per REST e upgrade: sono per IP e tutti i client dello script stanno su 127.0.0.1. Il limite sui
 * messaggi WebSocket (per connessione) resta quello del server. I limiti per IP sono coperti da `rest.test.ts`.
 */
const E2E_LIMITS: MockConfig['rateLimits'] = {
  general: { rate: 200, burst: 400 },
  auth: { rate: 100, burst: 100 },
  ws: { rate: 100, burst: 100 },
  wsMessages: (DEFAULT_CONFIG.rateLimits as Exclude<MockConfig['rateLimits'], false>).wsMessages,
};

export async function runE2E(selected: readonly string[] = E2E_SCENARIOS): Promise<ScenarioReport[]> {
  const reports: ScenarioReport[] = [];
  const base = { port: 0, quiet: true, botDelayMs: 20, reconnectTimeoutMs: 3000, rateLimits: E2E_LIMITS };
  const server = await startMockServer(base);
  const slowClockServer = await startMockServer({ ...base, baseTimeMs: 3000 });
  const pacer = createPacer();
  try {
    for (const name of selected) {
      const scenario = SCENARIOS[name];
      const report = new Report();
      let clients: E2EClient[] = [];
      if (scenario === undefined) report.problems.push(`scenario sconosciuto: ${name}`);
      else {
        try {
          clients = await scenario({ server, slowClockServer, pacer, report });
        } catch (error) {
          report.problems.push(error instanceof Error ? error.message : String(error));
        }
      }
      for (const client of clients) report.problems.push(...client.problems);
      reports.push({
        name,
        ok: report.problems.length === 0,
        checks: report.checks,
        problems: report.problems,
        decodeFailures: clients.reduce((sum, client) => sum + client.failures.length, 0),
        warningCodes: [...new Set(clients.flatMap((c) => c.warnings.map((w) => `${w.assumption}:${w.code}`)))].sort(),
      });
    }
  } finally {
    await server.close();
    await slowClockServer.close();
  }
  return reports;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const selected = process.argv.slice(2);
  const reports = await runE2E(selected.length > 0 ? selected : E2E_SCENARIOS);
  const out = process.stdout;
  for (const r of reports) {
    out.write(`\n${r.ok ? 'OK  ' : 'FAIL'} ${r.name}  (decode failure: ${r.decodeFailures}, warning: ${r.warningCodes.join(' ') || '—'})\n`);
    for (const check of r.checks) out.write(`   ✔ ${check}\n`);
    for (const problem of r.problems) out.write(`   ✘ ${problem}\n`);
  }
  const failed = reports.filter((r) => !r.ok).length;
  out.write(`\n${reports.length - failed}/${reports.length} scenari superati\n`);
  process.exit(failed === 0 ? 0 : 1);
}
