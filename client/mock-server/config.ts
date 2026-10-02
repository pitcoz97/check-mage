import { SCENARIO_NAMES, type ScenarioName } from './scenarios/names';

/**
 * Il mock replica chess-server, branch `fix/backend-requests` (commit `62475c9`). I commenti `file.go:riga`
 * in tutto `mock-server/` sono relativi a `internal/` di quel branch.
 */

/** Token bucket: `rate` richieste/s, capacità `burst` (golang.org/x/time/rate). */
export interface Bucket {
  readonly rate: number;
  readonly burst: number;
}

export interface RateLimits {
  /** Tutte le rotte (`api/router.go:30`, `middleware/ratelimit.go:156`). */
  readonly general: Bucket;
  /** Register, login e refresh (`api/router.go:40-45`, `middleware/ratelimit.go:157`). */
  readonly auth: Bucket;
  /** Upgrade `/ws`, prima dell'autenticazione (`api/router.go:62`, `middleware/ratelimit.go:158`). */
  readonly ws: Bucket;
  /** Messaggi per connessione WebSocket (`handlers/ws.go:60`, `game/client.go:106`). */
  readonly wsMessages: Bucket;
}

export interface MockConfig {
  readonly port: number;
  readonly scenario: ScenarioName;
  readonly seed: number;
  /** `config/config.go`: 10' + 5". */
  /** `PHASE_TIME_MAIN` e `PHASE_TIME_MOVE` (`config/config.go`): tempo di una fase Magie e della Mossa. */
  readonly phaseMainMs: number;
  readonly phaseMoveMs: number;
  readonly reconnectTimeoutMs: number;
  /** `handlers/auth.go:168,180`. */
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly rateLimits: RateLimits | false;
  /** `TRUSTED_PROXIES` (`config/config.go:76`): IP o CIDR IPv4 da cui accettare `X-Forwarded-For`/`X-Real-IP`. */
  readonly trustedProxies: readonly string[];
  /**
   * Heartbeat (`game/client.go:19-24`): ping ogni `pingMs`; senza traffico dal client per `pongWaitMs` la
   * connessione viene chiusa.
   */
  readonly heartbeat: { readonly pingMs: number; readonly pongWaitMs: number };
  /** Ritardo delle azioni dei bot, per rendere l'ordine dei messaggi realistico. */
  readonly botDelayMs: number;
  readonly quiet: boolean;
  /** `spells.UnlockAllCards` (C12): ogni utente ha tutte le carte al massimo di copie. Il set iniziale resta sotto. */
  readonly unlockAllCards: boolean;
  /** `handlers.AllFriends` (F1): tutti gli utenti sono amici fra loro. */
  readonly allFriends: boolean;
  /** `presence.Window` (F2): online chi ha mandato un segnale da meno di così. */
  readonly presenceWindowMs: number;
  /** `game.ChallengeTTL` (F4): durata di una sfida senza risposta. */
  readonly challengeTtlMs: number;
}

export const DEFAULT_CONFIG: MockConfig = {
  port: 8080,
  scenario: 'pvp',
  seed: 42,
  phaseMainMs: 90_000,
  phaseMoveMs: 120_000,
  reconnectTimeoutMs: 30_000,
  accessTokenTtlSeconds: 24 * 3600,
  refreshTokenTtlSeconds: 30 * 24 * 3600,
  rateLimits: {
    general: { rate: 10, burst: 20 },
    auth: { rate: 3, burst: 5 },
    ws: { rate: 1, burst: 3 },
    wsMessages: { rate: 5, burst: 10 },
  },
  trustedProxies: [],
  heartbeat: { pingMs: 54_000, pongWaitMs: 60_000 },
  botDelayMs: 150,
  quiet: false,
  unlockAllCards: true,
  allFriends: true,
  presenceWindowMs: 30_000,
  challengeTtlMs: 60_000,
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} deve essere un intero >= 0, ricevuto "${raw}"`);
  return value;
}

/** `getList` di `config/config.go:125-137`: lista separata da virgole, spazi ignorati. */
function listFromEnv(name: string, fallback: readonly string[]): readonly string[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(value);
}

export function configFromEnv(): MockConfig {
  const scenario = process.env['MOCK_SCENARIO'] ?? DEFAULT_CONFIG.scenario;
  if (!isScenarioName(scenario)) {
    throw new Error(`MOCK_SCENARIO sconosciuto: "${scenario}". Valori: ${SCENARIO_NAMES.join(', ')}`);
  }
  return {
    ...DEFAULT_CONFIG,
    port: intFromEnv('MOCK_PORT', DEFAULT_CONFIG.port),
    scenario,
    seed: intFromEnv('MOCK_SEED', DEFAULT_CONFIG.seed),
    phaseMainMs: intFromEnv('MOCK_PHASE_MAIN_MS', DEFAULT_CONFIG.phaseMainMs),
    phaseMoveMs: intFromEnv('MOCK_PHASE_MOVE_MS', DEFAULT_CONFIG.phaseMoveMs),
    reconnectTimeoutMs: intFromEnv('MOCK_RECONNECT_TIMEOUT_MS', DEFAULT_CONFIG.reconnectTimeoutMs),
    accessTokenTtlSeconds: intFromEnv('MOCK_ACCESS_TTL_S', DEFAULT_CONFIG.accessTokenTtlSeconds),
    trustedProxies: listFromEnv('MOCK_TRUSTED_PROXIES', DEFAULT_CONFIG.trustedProxies),
  };
}
