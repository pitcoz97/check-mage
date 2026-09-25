import { isType, type E2EClient } from './client';

/**
 * Pilotaggio del turno, condiviso fra lo script e2e (contro il mock) e la verifica del contratto (contro un server
 * qualunque). Reagisce agli eventi invece di assumere una fase per volta: il server può fermarsi o avanzare da solo.
 */

export const isMain = (c: E2EClient) => c.phase === 'main1' || c.phase === 'main2';

export interface TurnPlan {
  move?: string;
  /** Chiamata a ogni fase main in cui il server si ferma; restituisce quando ha finito di castare. */
  inMain?: (c: E2EClient) => Promise<void>;
  afterMove?: () => Promise<void>;
}

export async function waitMyTurn(c: E2EClient): Promise<void> {
  await c.until(() => c.gameOver !== null || (c.isMyTurn && (isMain(c) || c.phase === 'move')), 'inizio del proprio turno');
}

export async function leaveMainPhase(c: E2EClient, plan: TurnPlan): Promise<void> {
  if (c.gameOver !== null || !c.isMyTurn || !isMain(c)) return;
  const phase = c.phase;
  if (plan.inMain !== undefined) await plan.inMain(c);
  if (c.gameOver !== null || !c.isMyTurn || c.phase !== phase) return;
  c.send({ type: 'pass_phase' });
  await c.until(() => c.gameOver !== null || c.phase !== phase || !c.isMyTurn, `uscita da ${phase}`);
}

/** `ok` se la mossa è stata accettata, altrimenti il codice d'errore. */
export async function tryMove(c: E2EClient, move: string): Promise<string> {
  const from = c.send({ type: 'move', move });
  await c.until(
    () => c.gameOver !== null || c.phase !== 'move' || !c.isMyTurn || c.events.slice(from).some((e) => e.type === 'error'),
    `esito mossa ${move}`,
  );
  if (c.gameOver !== null || c.phase !== 'move' || !c.isMyTurn) return 'ok';
  return c.events.slice(from).find(isType('error'))?.error.code ?? 'unknown';
}

export async function playTurn(c: E2EClient, plan: TurnPlan = {}): Promise<void> {
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
