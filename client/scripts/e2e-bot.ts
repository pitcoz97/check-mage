/**
 * Prova end-to-end delle partite contro il bot (ASSUMPTIONS §13) con lo stack del client: adapter, connessione
 * (`/ws?bot=<livello>&color=…`, chiusura 4004) e reducer. Per ogni livello una partita: il client muove con la prima
 * mossa legale e passa le fasi delle magie, il bot risponde; dopo un tetto di turni il client abbandona. Senza
 * indirizzi usa il mock in-process; con `--http` e `--ws` gira contro un server vero (per esempio quello Go sulla
 * VM), registrando un account di prova.
 *
 * Uso:
 *   npm run e2e:bot
 *   npm run e2e:bot -- --http http://localhost:8080 --ws ws://localhost:8080/ws
 */

import { pathToFileURL } from 'node:url';

import { startMockServer } from '../mock-server/index';
import { BOT_LEVELS, type BotLevel } from '../src/game/model';
import { createPacer, E2EClient, isType } from './e2e/client';
import { playTurn } from './e2e/play';

const PASSWORD = 'Password1';
/** Turni propri giocati prima di abbandonare: basta a vedere il bot muovere e lanciare magie per un po'. */
const MAX_TURNS = 25;

class Report {
  readonly checks: string[] = [];
  readonly problems: string[] = [];
  expect(condition: boolean, label: string): void {
    (condition ? this.checks : this.problems).push(label);
  }
}

async function playAgainstBot(make: (name: string) => E2EClient, level: BotLevel, color: 'white' | 'black', report: Report): Promise<void> {
  const player = make(`bot_${level.slice(0, 3)}`);
  await player.register(PASSWORD);
  await player.login(PASSWORD);
  await player.connect(undefined, { bot: level, color });
  await player.until(() => player.state !== null, `game_state contro il bot ${level}`);

  const state = player.state;
  const botSide = color === 'white' ? 'black' : 'white';
  report.expect(player.color === color, `${level}: il giocatore ha il ${color === 'white' ? 'bianco' : 'nero'}`);
  report.expect(state?.friendly === true, `${level}: partita amichevole`);
  report.expect(state?.players?.[botSide].bot === level, `${level}: il lato del bot porta il livello (${String(state?.players?.[botSide].bot)})`);
  report.expect(state?.players?.[color].bot === undefined, `${level}: il lato del giocatore non è un bot`);

  for (let turn = 0; turn < MAX_TURNS && player.gameOver === null; turn++) await playTurn(player);
  const casts = player.events.filter((e) => e.type === 'spell_cast' && e.player === botSide).length;
  const botMoves = Math.floor((player.state?.moves.length ?? 0) / 2);
  report.expect(botMoves > 0 || player.gameOver !== null, `${level}: il bot muove (${player.state?.moves.length ?? 0} mosse giocate, ${casts} magie del bot)`);

  if (player.gameOver === null) {
    const from = player.send({ type: 'resign' });
    await player.event(from, isType('game_over'), 'game_over dopo l’abbandono');
  }
  report.expect(player.gameOver !== null, `${level}: partita conclusa (${player.gameOver?.result ?? '—'}, ${player.gameOver?.reason ?? '—'})`);
  report.expect(player.failures.length === 0, `${level}: nessun frame rifiutato dall'adapter (${player.failures.length})`);
  report.expect(player.problems.length === 0, `${level}: nessun problema del client (${player.problems.join('; ')})`);
  await player.disconnect();

  // Il salvataggio parte in background: si aspetta un attimo che la partita arrivi nello storico.
  let games = await player.games(player.account?.id ?? '');
  for (let i = 0; i < 20 && games.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    games = await player.games(player.account?.id ?? '');
  }
  const game = games[0];
  const bot = color === 'white' ? game?.blackBot : game?.whiteBot;
  report.expect(game !== undefined && !game.rated && bot === level, `${level}: nello storico, amichevole, col livello del bot (${String(bot)})`);
  report.expect((await player.me()).elo === 1200, `${level}: l'ELO non cambia`);
}

export async function runBotE2E(options: { httpUrl?: string; wsUrl?: string } = {}): Promise<Report> {
  const report = new Report();
  const mock = options.httpUrl === undefined ? await startMockServer({ port: 0, quiet: true, rateLimits: false, botDelayMs: 10 }) : null;
  const httpUrl = options.httpUrl ?? mock?.httpUrl ?? '';
  const wsUrl = options.wsUrl ?? mock?.wsUrl ?? '';
  // Contro un server vero l'upgrade del WebSocket è limitato a 1/s per IP (burst 3).
  const pacer = createPacer({ wsSpacingMs: mock === null ? 1_100 : 0 });
  const suffix = Date.now().toString(36).slice(-6);
  const make = (name: string) => new E2EClient(httpUrl, wsUrl, `${name}_${suffix}`, `${name}_${suffix}@e2e.local`, pacer);

  try {
    for (const [index, level] of BOT_LEVELS.entries()) await playAgainstBot(make, level, index % 2 === 0 ? 'white' : 'black', report);

    // Un livello sconosciuto: chiusura 4004 con bot_unavailable, nessuna partita.
    const lost = make('bot_none');
    await lost.register(PASSWORD);
    await lost.login(PASSWORD);
    await lost.connect(undefined, { bot: 'grandmaster', color: 'white' });
    await lost.until(() => lost.statusHistory.includes('bot_unavailable'), 'chiusura 4004');
    report.expect(lost.state === null, 'livello sconosciuto: 4004, nessuna partita');
    report.expect(lost.events.some((e) => e.type === 'error' && e.error.code === 'bot_unavailable'), 'livello sconosciuto: errore bot_unavailable');
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
  const report = await runBotE2E({ ...(http === undefined ? {} : { httpUrl: http.replace(/\/$/, '') }), ...(ws === undefined ? {} : { wsUrl: ws }) });
  for (const check of report.checks) process.stdout.write(`✔ ${check}\n`);
  for (const problem of report.problems) process.stdout.write(`✘ ${problem}\n`);
  process.stdout.write(`\n${report.checks.length} verificate · ${report.problems.length} problemi\n`);
  process.exit(report.problems.length === 0 ? 0 : 1);
}
