import { SCENARIO_NAMES, type ScenarioName } from './scenarios/names';

/** Token bucket: `rate` richieste/s, capacità `burst` (golang.org/x/time/rate). */
export interface Bucket {
  readonly rate: number;
  readonly burst: number;
}

export interface RateLimits {
  /** Tutte le rotte (`middleware/ratelimit.go:115`). */
  readonly general: Bucket;
  /** Solo register e login (`middleware/ratelimit.go:116`, `api/router.go:33-37`). */
  readonly auth: Bucket;
  /** Upgrade `/ws` (`middleware/ratelimit.go:117`). */
  readonly ws: Bucket;
  /** Messaggi per connessione WebSocket (`handlers/ws.go:36`). */
  readonly wsMessages: Bucket;
}

/**
 * `current` = chess-server così com'è (commit 7f817e5).
 * `proposed` = con le richieste da cui dipende il client: P0-5 (identità giocatori), P1-1 (/spells), P1-3 (codici errore).
 */
export type Contract = 'current' | 'proposed';

export interface MockConfig {
  readonly port: number;
  readonly contract: Contract;
  readonly scenario: ScenarioName;
  readonly seed: number;
  /** `config/config.go:61-63`. */
  readonly baseTimeMs: number;
  readonly incrementMs: number;
  readonly reconnectTimeoutMs: number;
  /** `handlers/auth.go:168,180`. */
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly rateLimits: RateLimits | false;
  /** Ritardo delle azioni dei bot, per rendere l'ordine dei messaggi realistico. */
  readonly botDelayMs: number;
  readonly quiet: boolean;
}

export const DEFAULT_CONFIG: MockConfig = {
  port: 8080,
  contract: 'proposed',
  scenario: 'pvp',
  seed: 42,
  baseTimeMs: 10 * 60_000,
  incrementMs: 5_000,
  reconnectTimeoutMs: 30_000,
  accessTokenTtlSeconds: 24 * 3600,
  refreshTokenTtlSeconds: 30 * 24 * 3600,
  rateLimits: {
    general: { rate: 10, burst: 20 },
    auth: { rate: 3, burst: 5 },
    ws: { rate: 1, burst: 3 },
    wsMessages: { rate: 5, burst: 10 },
  },
  botDelayMs: 150,
  quiet: false,
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} deve essere un intero >= 0, ricevuto "${raw}"`);
  return value;
}

export function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(value);
}

export function configFromEnv(): MockConfig {
  const scenario = process.env['MOCK_SCENARIO'] ?? DEFAULT_CONFIG.scenario;
  if (!isScenarioName(scenario)) {
    throw new Error(`MOCK_SCENARIO sconosciuto: "${scenario}". Valori: ${SCENARIO_NAMES.join(', ')}`);
  }
  const contract = process.env['MOCK_CONTRACT'] ?? DEFAULT_CONFIG.contract;
  if (contract !== 'current' && contract !== 'proposed') {
    throw new Error(`MOCK_CONTRACT deve essere "current" o "proposed", ricevuto "${contract}"`);
  }
  return {
    ...DEFAULT_CONFIG,
    port: intFromEnv('MOCK_PORT', DEFAULT_CONFIG.port),
    contract,
    scenario,
    seed: intFromEnv('MOCK_SEED', DEFAULT_CONFIG.seed),
    baseTimeMs: intFromEnv('MOCK_BASE_TIME_MS', DEFAULT_CONFIG.baseTimeMs),
    incrementMs: intFromEnv('MOCK_INCREMENT_MS', DEFAULT_CONFIG.incrementMs),
    reconnectTimeoutMs: intFromEnv('MOCK_RECONNECT_TIMEOUT_MS', DEFAULT_CONFIG.reconnectTimeoutMs),
    accessTokenTtlSeconds: intFromEnv('MOCK_ACCESS_TTL_S', DEFAULT_CONFIG.accessTokenTtlSeconds),
  };
}
