/**
 * Prova end-to-end del contratto: avvia il mock (porting di chess-server) in-process, per ciascun contratto
 * (`current`, `proposed`), e gioca partite reali passando SOLO per `src/api/adapter.ts`.
 * Uso: `npm run mock:e2e [-- scenario ...]`.
 */

import { pathToFileURL } from 'node:url';

import type { Contract } from '../mock-server/config';
import { startMockServer, type MockServerHandle } from '../mock-server/index';
import type { AdapterWarningCode } from '../src/api/adapter';
import type { Color, Square } from '../src/game/model';
import type { Spell } from '../src/spells/schema';
import type { DecodeFailure } from '../src/ws/protocol';
import { createPacer, E2EClient, isType, type Pacer } from './e2e/client';

const PASSWORD = 'Password1';
const CONTRACTS: readonly Contract[] = ['current', 'proposed'];

export interface ScenarioReport {
  contract: Contract;
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
  contract: Contract;
  server: MockServerHandle;
  slowClockServer: MockServerHandle;
  pacer: Pacer;
  report: Report;
}

// ---------------------------------------------------------------------------------------------------
// Pilotaggio del turno (reagisce agli eventi, non assume una fase per volta)
// ---------------------------------------------------------------------------------------------------

const isMain = (c: E2EClient) => c.phase === 'main1' || c.phase === 'main2';

interface TurnPlan {
  move?: string;
  /** Chiamata a ogni fase main in cui il server si ferma; restituisce quando ha finito di castare. */
  inMain?: (c: E2EClient) => Promise<void>;
  afterMove?: () => Promise<void>;
}

async function waitMyTurn(c: E2EClient): Promise<void> {
  await c.until(() => c.gameOver !== null || (c.isMyTurn && (isMain(c) || c.phase === 'move')), 'inizio del proprio turno');
}

async function leaveMainPhase(c: E2EClient, plan: TurnPlan): Promise<void> {
  if (c.gameOver !== null || !c.isMyTurn || !isMain(c)) return;
  const phase = c.phase;
  if (plan.inMain !== undefined) await plan.inMain(c);
  if (c.gameOver !== null || !c.isMyTurn || c.phase !== phase) return;
  c.send({ type: 'pass_phase' });
  await c.until(() => c.gameOver !== null || c.phase !== phase || !c.isMyTurn, `uscita da ${phase}`);
}

/** `ok` se la mossa è stata accettata, altrimenti il codice d'errore. */
async function tryMove(c: E2EClient, move: string): Promise<string> {
  const from = c.send({ type: 'move', move });
  await c.until(
    () => c.gameOver !== null || c.phase !== 'move' || !c.isMyTurn || c.events.slice(from).some((e) => e.type === 'error'),
    `esito mossa ${move}`,
  );
  if (c.gameOver !== null || c.phase !== 'move' || !c.isMyTurn) return 'ok';
  return c.events.slice(from).find(isType('error'))?.error.code ?? 'unknown';
}

async function playTurn(c: E2EClient, plan: TurnPlan = {}): Promise<void> {
  await waitMyTurn(c);
  await leaveMainPhase(c, plan);
  if (c.gameOver !== null || !c.isMyTurn) return;
  await c.until(() => c.gameOver !== null || c.phase === 'move', 'fase move');
  if (c.gameOver !== null) return;

  const avoid = new Set<string>();
  let candidate = plan.move ?? c.pickMove(avoid);
  for (let attempt = 0; candidate !== null && attempt < 30; attempt++) {
    const outcome = await tryMove(c, candidate);
    if (outcome === 'ok') break;
    if (plan.move !== undefined) throw new Error(`${c.username}: mossa ${candidate} rifiutata (${outcome})`);
    avoid.add(candidate);
    candidate = c.pickMove(avoid);
  }
  if (c.gameOver !== null) return;
  if (plan.afterMove !== undefined) await plan.afterMove();
  if (c.connected) await leaveMainPhase(c, plan);
}

/** Casta le carte abbordabili con bersagli semplici (pedoni sulle colonne a/h). Restituisce i cast riusciti. */
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
        const from = c.send({ type: 'cast_spell', card: expensive, targets: [] });
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
        return spell !== undefined && !tried.has(h.spellId) && spell.manaCost <= c.myMana && spell.targetType !== 'piece_move';
      });
      if (card === undefined) return;
      tried.add(card.spellId);
      const spell = catalog.find((s) => s.id === card.spellId) as Spell;
      const target =
        spell.targetType === 'none'
          ? []
          : spell.targetType === 'enemy_piece'
            ? [pawnOn('h', color === 'white' ? 'black' : 'white')]
            : [pawnOn('a', color)];
      if (target.some((t) => t === null)) continue;
      const from = c.send({ type: 'cast_spell', card, targets: target as Square[] });
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

/** Nel contratto `current` il colore lo conosce lo script (ordine di connessione), non il client. */
async function ensureColor(ctx: Ctx, c: E2EClient, expected: Color): Promise<void> {
  await c.event(0, isType('game_state'), 'primo game_state');
  if (ctx.contract === 'current') {
    ctx.report.expect(c.color === null, `${c.username}: nessuna identità dei giocatori nel contratto current`);
    c.color = expected;
  } else {
    ctx.report.expect(c.color === expected, `${c.username}: colore ${String(c.color)} da P0-5`);
  }
}

async function resignAndWait(c: E2EClient): Promise<void> {
  if (c.gameOver !== null) return;
  c.send({ type: 'resign' });
  await c.until(() => c.gameOver !== null, 'game_over dopo la resa');
}

function unexpectedWarnings(ctx: Ctx, clients: E2EClient[], allowed: readonly AdapterWarningCode[] = []): string[] {
  const always: AdapterWarningCode[] = ctx.contract === 'current' ? ['players_missing'] : [];
  return [...new Set(clients.flatMap((c) => c.warnings.map((w) => w.code)))].filter(
    (code) => !always.includes(code) && !allowed.includes(code),
  );
}

// ---------------------------------------------------------------------------------------------------
// Scenari
// ---------------------------------------------------------------------------------------------------

type Scenario = (ctx: Ctx) => Promise<E2EClient[]>;

const SCENARIOS: Record<string, Scenario> = {
  /** Due client reali: auth completa, rifiuti, magie, matto dell'imbecille, ELO e storico. */
  async pvp(ctx) {
    const { server, pacer, report } = ctx;
    const white = await newPlayer(server, pacer, `mario_${ctx.contract}`);
    const black = await newPlayer(server, pacer, `luigi_${ctx.contract}`);
    report.expect(white.account?.elo === 1200, 'login: ELO iniziale 1200');
    await white.refresh();
    report.expect((await white.me()).email === white.email, 'refresh del token e /me con il token nuovo');
    const catalog = await white.catalog();
    report.expect(catalog.spells.length === 11, `catalogo: ${catalog.spells.length} magie da ${catalog.source}`);
    report.expect(catalog.source === (ctx.contract === 'proposed' ? 'server' : 'fallback'), '/spells solo nel contratto proposed');

    await white.connect('pvp');
    await black.connect('pvp');
    await ensureColor(ctx, white, 'white');
    await ensureColor(ctx, black, 'black');
    await white.event(0, isType('hand'), 'hand privata');
    report.expect(white.hand.length === 4 && black.hand.length === 4, 'mani iniziali da 4');

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
      const move = whiteMoves[i];
      if (move !== undefined && white.gameOver === null) await playTurn(white, { move, inMain });
    }
    await white.until(() => white.gameOver !== null && black.gameOver !== null, 'game_over su entrambi');
    report.expect(counter.casts > 0, `magie accettate: ${counter.casts}`);
    report.expect(counter.insufficientChecked, 'rifiuto per mana insufficiente verificato');
    const over = white.gameOver;
    report.expect(over?.result === '0-1' && over.reason === 'checkmate' && over.winner === black.username, `game_over ${over?.result} ${over?.reason} ${over?.winner}`);

    await white.disconnect();
    await black.disconnect();
    const id = white.account?.id ?? '';
    const profile = await white.profile(id);
    const elo = (await white.me()).elo;
    report.expect(profile.stats.losses === 1 && elo < 1200, `ELO e statistiche aggiornati (${elo})`);
    const games = await white.games(id);
    report.expect(games.length === 1 && games[0]?.timeControl === '10+0', 'storico partite con time_control "10+0" (B6)');
    const unexpected = unexpectedWarnings(ctx, [white, black]);
    report.expect(unexpected.length === 0 && white.failures.length + black.failures.length === 0, `nessun warning inatteso né decode failure ${unexpected.join(',')}`);
    return [white, black];
  },

  /** Contro bot: matto del barbiere, con disconnessione e rientro del client a metà partita (G5). */
  async checkmate(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `anna_${ctx.contract}`);
    await c.connect('checkmate');
    await ensureColor(ctx, c, 'white');
    await c.event(0, isType('hand'), 'hand');
    await playTurn(c, {
      move: 'e2e4',
      afterMove: async () => {
        const handBefore = c.hand.map((h) => h.spellId).sort();
        await c.disconnect();
        const from = c.events.length;
        await c.connect();
        const resumed = await c.event(from, isType('game_state'), 'game_state al rientro');
        const hand = await c.event(from, isType('hand'), 'hand al rientro');
        ctx.report.expect(resumed.state.reconnected && resumed.state.moves.includes('e2e4'), 'G5: game_state con reconnected e mosse');
        ctx.report.expect(JSON.stringify(hand.hand.cards.map((h) => h.spellId).sort()) === JSON.stringify(handBefore), 'G5: mano ripristinata');
      },
    });
    for (const move of ['d1h5', 'f1c4', 'h5f7']) await playTurn(c, { move });
    await c.until(() => c.gameOver !== null, 'game_over');
    ctx.report.expect(c.gameOver?.reason === 'checkmate' && c.gameOver.winner === c.username, `matto: ${c.gameOver?.reason}`);
    ctx.report.expect(unexpectedWarnings(ctx, [c]).length === 0 && c.failures.length === 0, 'nessun warning inatteso né decode failure');
    await c.disconnect();
    return [c];
  },

  /** Il "server" si riavvia: il socket si chiude, il client rientra e la partita prosegue. */
  async restart(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `bea_${ctx.contract}`);
    await c.connect('restart');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.until(() => !c.connected, 'chiusura del socket per riavvio');
    const from = c.events.length;
    await c.connect();
    const resumed = await c.event(from, isType('game_state'), 'game_state dopo il riavvio');
    ctx.report.expect(resumed.state.reconnected, 'rientro dopo il riavvio con reconnected: true');
    await playTurn(c);
    ctx.report.expect(c.gameOver === null, 'la partita prosegue dopo il riavvio');
    await resignAndWait(c);
    await c.disconnect();
    return [c];
  },

  /** Frame malformati e type sconosciuti intercalati a una partita valida. */
  async hostile(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `carla_${ctx.contract}`);
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

  /** Il bot casta tutti e sette i kind di effetto. */
  async spells(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `dario_${ctx.contract}`);
    await c.connect('spells');
    await ensureColor(ctx, c, 'white');
    const wanted = ['noop', 'destroy_piece', 'freeze_piece', 'shield_piece', 'draw_card', 'gain_mana', 'move_piece'];
    const seen = () => new Set<string>(c.events.filter(isType('spell_cast')).flatMap((e) => e.effects.map((x) => x.kind)));
    for (let turn = 0; turn < 6 && c.gameOver === null && !wanted.every((k) => seen().has(k)); turn++) await playTurn(c);
    await c.until(() => wanted.every((k) => seen().has(k)) || c.gameOver !== null, 'tutti gli effetti', 10_000).catch(() => undefined);
    ctx.report.expect(wanted.every((k) => seen().has(k)), `effetti visti: ${[...seen()].join(', ')}`);
    ctx.report.expect(
      c.events.some((e) => e.type === 'game_state' && e.state.activeEffects.some((s) => s.effects.some((x) => x.sourceSpellId === 'frostbolt'))),
      'active_effects con source_spell_id',
    );
    await resignAndWait(c);
    ctx.report.expect(unexpectedWarnings(ctx, [c]).length === 0 && c.failures.length === 0, 'nessun warning inatteso né decode failure');
    await c.disconnect();
    return [c];
  },

  /** Patta: offerta del bot rifiutata, prima offerta del client rifiutata, seconda accettata. */
  async draw(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `elena_${ctx.contract}`);
    await c.connect('draw');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.event(0, isType('draw_offer'), 'draw_offer dal bot');
    c.send({ type: 'draw_declined' });
    const from = c.send({ type: 'draw_offer' });
    await c.event(from, isType('draw_offer_sent'), 'draw_offer_sent');
    await c.event(from, isType('draw_declined'), 'rifiuto del bot');
    ctx.report.expect(true, 'draw_offer_sent e draw_declined ricevuti');
    c.send({ type: 'draw_offer' });
    await c.until(() => c.gameOver !== null, 'game_over');
    ctx.report.expect(c.gameOver?.reason === 'agreement' && c.gameOver.result === '1/2-1/2' && c.gameOver.winner === null, 'patta per accordo senza vincitore');
    await c.disconnect();
    return [c];
  },

  async abandon(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `fabio_${ctx.contract}`);
    await c.connect('abandon');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.event(0, isType('opponent_disconnected'), 'opponent_disconnected');
    await c.until(() => c.gameOver !== null, 'game_over per abbandono', 15_000);
    ctx.report.expect(c.gameOver?.reason === 'abandonment' && c.gameOver.winner === c.username, `abbandono: ${c.gameOver?.reason}`);
    await c.disconnect();
    return [c];
  },

  async reconnect(ctx) {
    const c = await newPlayer(ctx.server, ctx.pacer, `gina_${ctx.contract}`);
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
    const c = await newPlayer(ctx.slowClockServer, ctx.pacer, `hugo_${ctx.contract}`);
    await c.connect('timeout');
    await ensureColor(ctx, c, 'white');
    await playTurn(c);
    await c.until(() => c.gameOver !== null, 'game_over per tempo', 15_000);
    ctx.report.expect(c.gameOver?.reason === 'timeout' && c.gameOver.winner === c.username, `tempo: ${c.gameOver?.reason}`);
    const update = c.events.filter(isType('timer_update')).at(-1);
    ctx.report.expect(update?.turn === 'black', 'timer_update.turn è il giocatore attivo');
    await c.disconnect();
    return [c];
  },
};

export const E2E_SCENARIOS = Object.keys(SCENARIOS);

export async function runE2E(selected: readonly string[] = E2E_SCENARIOS): Promise<ScenarioReport[]> {
  const reports: ScenarioReport[] = [];
  for (const contract of CONTRACTS) {
    const base = { port: 0, quiet: true, botDelayMs: 20, reconnectTimeoutMs: 3000, contract };
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
            clients = await scenario({ contract, server, slowClockServer, pacer, report });
          } catch (error) {
            report.problems.push(error instanceof Error ? error.message : String(error));
          }
        }
        for (const client of clients) report.problems.push(...client.problems);
        reports.push({
          contract,
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
  }
  return reports;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const selected = process.argv.slice(2);
  const reports = await runE2E(selected.length > 0 ? selected : E2E_SCENARIOS);
  const out = process.stdout;
  for (const r of reports) {
    out.write(`\n${r.ok ? 'OK  ' : 'FAIL'} [${r.contract}] ${r.name}  (decode failure: ${r.decodeFailures}, warning: ${r.warningCodes.join(' ') || '—'})\n`);
    for (const check of r.checks) out.write(`   ✔ ${check}\n`);
    for (const problem of r.problems) out.write(`   ✘ ${problem}\n`);
  }
  const failed = reports.filter((r) => !r.ok).length;
  out.write(`\n${reports.length - failed}/${reports.length} scenari superati\n`);
  process.exit(failed === 0 ? 0 : 1);
}
