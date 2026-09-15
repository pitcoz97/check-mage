/**
 * Prova end-to-end del contratto: avvia il mock in-process e gioca partite reali passando SOLO per
 * `src/api/adapter.ts`. Uso: `npm run mock:e2e [-- scenario ...]`.
 */

import { pathToFileURL } from 'node:url';

import { Chess } from 'chess.js';

import { startMockServer, type MockServerHandle } from '../mock-server/index';
import type { AdapterWarningCode } from '../src/api/adapter';
import type { Square } from '../src/game/model';
import type { Spell } from '../src/spells/schema';
import type { DecodeFailure } from '../src/ws/protocol';
import { createPacer, E2EClient, isType, type Pacer } from './e2e/client';

const PASSWORD = 'password123';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// ---------------------------------------------------------------------------------------------------
// Pilotaggio del turno
// ---------------------------------------------------------------------------------------------------

async function passTo(c: E2EClient, phase: 'main1' | 'move'): Promise<void> {
  c.send({ type: 'pass_phase' });
  await c.until(() => c.phase === phase || c.gameOver !== null, `fase ${phase}`);
}

/** `ok` se la mossa è stata accettata, altrimenti il codice d'errore. */
async function tryMove(c: E2EClient, move: string): Promise<string> {
  const from = c.send({ type: 'move', move });
  const rejected = () => c.events.slice(from).some((e) => e.type === 'error');
  await c.until(() => c.phase !== 'move' || c.gameOver !== null || rejected(), `esito mossa ${move}`);
  if (c.phase === 'move' && c.gameOver === null) await sleep(50); // un error estraneo può precedere main2
  if (c.phase !== 'move' || c.gameOver !== null) return 'ok';
  return c.events.slice(from).find(isType('error'))?.error.code ?? 'unknown';
}

async function expectError(c: E2EClient, from: number, code: string, report: Report, label: string): Promise<void> {
  const error = await c.event(from, isType('error'), label);
  report.expect(error.error.code === code, `${label} → error.code=${String(error.error.code)} (atteso ${code})`);
}

function firstLegalMove(fen: string, avoid: ReadonlySet<string>): string | null {
  const chess = new Chess(fen);
  const move = chess.moves({ verbose: true }).find((m) => !avoid.has(m.lan));
  return move?.lan ?? null;
}

interface TurnPlan {
  move?: string;
  main1?: () => Promise<void>;
  afterMove?: () => Promise<void>;
}

async function playTurn(c: E2EClient, plan: TurnPlan = {}): Promise<void> {
  await c.until(() => (c.isMyTurn && c.phase === 'draw') || c.gameOver !== null, 'inizio del proprio turno');
  if (c.gameOver !== null) return;
  await passTo(c, 'main1');
  if (plan.main1 !== undefined) await plan.main1();
  await passTo(c, 'move');
  if (c.gameOver !== null) return;

  const avoid = new Set<string>();
  let candidate = plan.move ?? firstLegalMove(c.fen, avoid);
  for (let attempt = 0; candidate !== null && attempt < 20; attempt++) {
    const outcome = await tryMove(c, candidate);
    if (outcome === 'ok') break;
    if (plan.move !== undefined) throw new Error(`${c.username}: mossa ${candidate} rifiutata (${outcome})`);
    avoid.add(candidate);
    candidate = firstLegalMove(c.fen, avoid);
  }
  if (c.gameOver !== null) return;
  if (plan.afterMove !== undefined) await plan.afterMove();
  c.send({ type: 'pass_phase' });
  await c.until(() => !c.isMyTurn || c.gameOver !== null, 'fine del proprio turno');
}

/** Casta la prima magia abbordabile con bersaglio semplice. `true` se il server l'ha accettata. */
async function castAffordable(c: E2EClient, catalog: readonly Spell[], color: 'white' | 'black'): Promise<boolean> {
  const targetsFor: Record<string, Square[]> = {
    none: [],
    own_piece: [color === 'white' ? 'a2' : 'a7'],
    enemy_piece: [color === 'white' ? 'h7' : 'h2'],
  };
  for (const card of [...c.hand]) {
    const spell = catalog.find((s) => s.id === card.spellId);
    const targets = spell === undefined ? undefined : targetsFor[spell.targetType];
    if (spell === undefined || targets === undefined || spell.manaCost > c.myMana.current) continue;
    if (spell.effects.some((e) => e.kind === 'move_piece')) continue;
    const from = c.send({ type: 'cast_spell', card, targets });
    const outcome = await c.event(
      from,
      (e): e is Extract<typeof e, { type: 'spell_cast' | 'error' }> =>
        (e.type === 'spell_cast' && e.player === c.username) || e.type === 'error',
      `esito cast ${spell.id}`,
    );
    return outcome.type === 'spell_cast';
  }
  return false;
}

async function newPlayer(server: MockServerHandle, pacer: Pacer, username: string): Promise<E2EClient> {
  const client = new E2EClient(server.httpUrl, server.wsUrl, username, pacer);
  await client.register(PASSWORD);
  await client.login(PASSWORD);
  return client;
}

async function resignAndWait(c: E2EClient): Promise<void> {
  if (c.gameOver !== null) return;
  c.send({ type: 'resign' });
  await c.until(() => c.gameOver !== null, 'game_over dopo la resa');
}

function sameWarnings(clients: E2EClient[]): string[] {
  return [...new Set(clients.flatMap((c) => c.warnings.map((w) => `${w.assumption}:${w.code}`)))].sort();
}

// ---------------------------------------------------------------------------------------------------
// Scenari
// ---------------------------------------------------------------------------------------------------

type Scenario = (ctx: { server: MockServerHandle; slowClockServer: MockServerHandle; pacer: Pacer; report: Report }) => Promise<E2EClient[]>;

const SCENARIOS: Record<string, Scenario> = {
  /** Due client reali: rifiuti, magie, matto dell'imbecille, ELO aggiornato. */
  async pvp({ server, pacer, report }) {
    const white = await newPlayer(server, pacer, 'mario_e2e');
    const black = await newPlayer(server, pacer, 'luigi_e2e');
    report.expect(white.profile?.elo === 1200, 'ELO iniziale 1200');
    const catalog = await white.catalog();
    report.expect(catalog.length === 6, `catalogo da /spells: ${catalog.length} magie`);

    await white.connect('pvp');
    await black.connect('pvp');
    const start = await white.event(0, isType('game_start'), 'game_start');
    report.expect(start.snapshot.players.white === 'mario_e2e' && start.snapshot.players.black === 'luigi_e2e', 'accoppiamento pvp');
    report.expect((start.snapshot.hand?.length ?? 0) === 5 && start.snapshot.pieces?.length === 32, 'snapshot completo (G1, G4)');

    let casts = 0;
    // Turno 1 del bianco: i tre rifiuti richiesti.
    await white.until(() => white.isMyTurn && white.phase === 'draw', 'primo turno del bianco');
    await passTo(white, 'main1');
    const expensive = white.hand.find((card) => (catalog.find((s) => s.id === card.spellId)?.manaCost ?? 0) > white.myMana.current);
    report.expect(expensive !== undefined, 'in mano c’è una carta non abbordabile');
    if (expensive !== undefined) {
      const from = white.send({ type: 'cast_spell', card: expensive, targets: ['h7'] });
      await expectError(white, from, 'insufficient_mana', report, 'cast con mana insufficiente');
    }
    await passTo(white, 'move');
    await expectError(white, white.send({ type: 'move', move: 'e2e5' }), 'illegal_move', report, 'mossa illegale');
    await expectError(white, white.send({ type: 'pass_phase' }), 'wrong_phase', report, 'pass_phase in fase move');
    report.expect((await tryMove(white, 'g1f3')) === 'ok', 'mossa legale accettata dopo i rifiuti');
    white.send({ type: 'pass_phase' });
    await white.until(() => !white.isMyTurn, 'fine turno 1 del bianco');

    const whiteMoves = ['f3g1', 'g1f3', 'f3g1', 'f2f3', 'g2g4'];
    const blackMoves = ['g8f6', 'f6g8', 'g8f6', 'f6g8', 'e7e5', 'd8h4'];
    const castHook = (c: E2EClient, color: 'white' | 'black') => async () => {
      if (await castAffordable(c, catalog, color)) casts += 1;
    };
    for (let turn = 0; turn < blackMoves.length && white.gameOver === null; turn++) {
      await playTurn(black, { move: blackMoves[turn] as string, main1: castHook(black, 'black') });
      const move = whiteMoves[turn];
      if (move !== undefined) await playTurn(white, { move, main1: castHook(white, 'white') });
    }
    await white.until(() => white.gameOver !== null && black.gameOver !== null, 'game_over su entrambi');
    report.expect(casts > 0, `magie castate e accettate: ${casts}`);
    const over = white.gameOver;
    report.expect(
      over?.result === '0-1' && over.reason === 'checkmate' && over.winner === 'luigi_e2e',
      `game_over ${over?.result} ${over?.reason} vincitore ${over?.winner}`,
    );

    const profile = await white.refreshProfile();
    report.expect(profile.elo < 1200 && profile.stats?.losses === 1, `ELO dopo la sconfitta: ${profile.elo}`);
    const games = await white.get(`/users/${profile.id}/games`);
    report.expect(Array.isArray(games.json) && games.json.length === 1, 'storico partite aggiornato');
    report.expect(white.warnings.length + black.warnings.length === 0, 'nessun warning: mock e adapter allineati');
    await white.disconnect();
    await black.disconnect();
    return [white, black];
  },

  /** Contro bot: matto del barbiere, con disconnessione e rientro del client a metà (G5). */
  async checkmate({ server, pacer, report }) {
    const c = await newPlayer(server, pacer, 'anna_e2e');
    await c.connect('checkmate');
    await c.event(0, isType('game_start'), 'game_start');
    await playTurn(c, {
      move: 'e2e4',
      afterMove: async () => {
        const handBefore = c.hand.map((card) => card.instanceId).sort();
        await c.disconnect();
        const from = c.events.length;
        await c.connect();
        const resumed = await c.event(from, isType('game_start'), 'game_start alla riconnessione');
        report.expect(
          JSON.stringify((resumed.snapshot.hand ?? []).map((card) => card.instanceId).sort()) === JSON.stringify(handBefore),
          'G5: la mano torna identica dopo il rientro',
        );
        report.expect(resumed.snapshot.phase === 'main2' && resumed.snapshot.moves.includes('e2e4'), 'G5: fase e mosse ripristinate');
      },
    });
    for (const move of ['d1h5', 'f1c4', 'h5f7']) await playTurn(c, { move });
    await c.until(() => c.gameOver !== null, 'game_over');
    report.expect(c.gameOver?.reason === 'checkmate' && c.gameOver.winner === 'anna_e2e', `matto: ${c.gameOver?.reason}`);
    report.expect(c.warnings.length === 0 && c.failures.length === 0, 'nessun warning né decode failure');
    await c.disconnect();
    return [c];
  },

  /** Il mock parla solo il contratto documentato: l'adapter deve degradare, non rompersi. */
  async 'contract-minimal'({ server, pacer, report }) {
    const c = await newPlayer(server, pacer, 'bruno_e2e');
    await c.connect('contract-minimal');
    await c.until(() => c.hand.length === 5 && c.phase === 'draw', 'mano ricostruita da card_drawn');
    report.expect(c.hand.every((card) => card.instanceIdIsLocal), 'G2: id d’istanza locali');
    await playTurn(c);
    const from = c.send({ type: 'pass_phase' }); // fuori turno
    const error = await c.event(from, isType('error'), 'error fuori turno');
    report.expect(error.error.code === null, 'G6: error senza codice decodificato come code=null');
    await playTurn(c);
    await resignAndWait(c);
    const codes = new Set(c.warnings.map((w) => w.code));
    const expected: AdapterWarningCode[] = [
      'snapshot_incomplete',
      'pieces_missing',
      'card_spell_id_missing',
      'deck_size_missing',
      'error_unstructured',
    ];
    for (const code of expected) report.expect(codes.has(code), `warning atteso: ${code}`);
    report.expect(c.failures.length === 0, 'nessun decode failure');
    report.expect(c.gameOver?.reason === 'resign', 'partita conclusa');
    await c.disconnect();
    return [c];
  },

  /** Frame malformati e type sconosciuti intercalati a una partita valida. */
  async hostile({ server, pacer, report }) {
    const c = await newPlayer(server, pacer, 'carla_e2e');
    await c.connect('hostile');
    for (let turn = 0; turn < 3; turn++) await playTurn(c);
    await resignAndWait(c);
    const kinds = new Set(c.failures.map((f) => f.kind));
    report.expect(c.problems.length === 0, 'l’adapter non ha mai lanciato eccezioni');
    const expectedKinds: DecodeFailure['kind'][] = ['invalid_json', 'not_an_envelope', 'unknown_type', 'malformed_payload'];
    report.expect(expectedKinds.every((k) => kinds.has(k)), `failure gestiti: ${[...kinds].join(', ')}`);
    report.expect(c.gameOver?.reason === 'resign', 'partita conclusa nonostante il rumore');
    await c.disconnect();
    return [c];
  },

  /** Il bot casta tutte e sei le magie: il client deve vederne gli effetti. */
  async spells({ server, pacer, report }) {
    const c = await newPlayer(server, pacer, 'dario_e2e');
    await c.connect('spells');
    const wanted = ['destroy_piece', 'move_piece', 'freeze_piece', 'draw_card', 'shield_piece', 'gain_mana'];
    const seen = () => new Set(c.events.filter(isType('spell_cast')).flatMap((e) => e.effects.map((x) => x.kind)));
    for (let turn = 0; turn < 8 && c.gameOver === null && !wanted.every((k) => seen().has(k)); turn++) await playTurn(c);
    await c.until(() => wanted.every((k) => seen().has(k)) || c.gameOver !== null, 'tutti gli effetti', 10_000).catch(() => undefined);
    report.expect(wanted.every((k) => seen().has(k)), `effetti visti: ${[...seen()].join(', ')}`);
    report.expect(c.events.some((e) => e.type === 'effect_applied' && e.effect.kind === 'freeze'), 'effect_applied freeze');
    report.expect(c.hand.length > 0 && c.events.filter(isType('hand_size_changed')).some((e) => e.deckSize !== null), 'A14: deck_size presente');
    await resignAndWait(c);
    report.expect(c.warnings.length === 0 && c.failures.length === 0, 'nessun warning né decode failure');
    await c.disconnect();
    return [c];
  },

  async draw({ server, pacer, report }) {
    const c = await newPlayer(server, pacer, 'elena_e2e');
    await c.connect('draw');
    await playTurn(c);
    const offer = await c.event(0, isType('draw_offer'), 'draw_offer dal bot');
    report.expect(offer.from === 'mock_bot', 'offerta ricevuta dal bot');
    c.send({ type: 'draw_accepted' });
    await c.until(() => c.gameOver !== null, 'game_over');
    report.expect(c.gameOver?.reason === 'agreement' && c.gameOver.result === '1/2-1/2' && c.gameOver.winner === null, 'patta per accordo');
    await c.disconnect();
    return [c];
  },

  async abandon({ server, pacer, report }) {
    const c = await newPlayer(server, pacer, 'fabio_e2e');
    await c.connect('abandon');
    await playTurn(c);
    await c.event(0, isType('opponent_disconnected'), 'opponent_disconnected');
    await c.until(() => c.gameOver !== null, 'game_over per abbandono', 15_000);
    report.expect(c.gameOver?.reason === 'abandonment' && c.gameOver.winner === 'fabio_e2e', `abbandono: ${c.gameOver?.reason}`);
    await c.disconnect();
    return [c];
  },

  async reconnect({ server, pacer, report }) {
    const c = await newPlayer(server, pacer, 'gina_e2e');
    await c.connect('reconnect');
    await playTurn(c);
    await c.event(0, isType('opponent_disconnected'), 'opponent_disconnected');
    await playTurn(c); // il bot rientra e completa il suo turno
    report.expect(c.gameOver === null, 'nessuna vittoria per abbandono: il bot è rientrato');
    await resignAndWait(c);
    await c.disconnect();
    return [c];
  },

  async timeout({ slowClockServer, pacer, report }) {
    const c = await newPlayer(slowClockServer, pacer, 'hugo_e2e');
    await c.connect('timeout');
    await playTurn(c);
    await c.until(() => c.gameOver !== null, 'game_over per tempo', 15_000);
    report.expect(c.gameOver?.reason === 'timeout' && c.gameOver.winner === 'hugo_e2e', `tempo: ${c.gameOver?.reason}`);
    report.expect(c.events.some((e) => e.type === 'timer_update'), 'timer_update ricevuti');
    await c.disconnect();
    return [c];
  },
};

export const E2E_SCENARIOS = Object.keys(SCENARIOS);

export async function runE2E(selected: readonly string[] = E2E_SCENARIOS): Promise<ScenarioReport[]> {
  const base = { port: 0, quiet: true, botDelayMs: 20, reconnectTimeoutMs: 3000 };
  const server = await startMockServer(base);
  const slowClockServer = await startMockServer({ ...base, clockMs: 3000 });
  const pacer = createPacer();
  const reports: ScenarioReport[] = [];
  try {
    for (const name of selected) {
      const scenario = SCENARIOS[name];
      const report = new Report();
      let clients: E2EClient[] = [];
      if (scenario === undefined) {
        report.problems.push(`scenario sconosciuto: ${name}`);
      } else {
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
        warningCodes: sameWarnings(clients),
      });
    }
  } finally {
    await server.close();
    await slowClockServer.close();
  }
  return reports;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
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
