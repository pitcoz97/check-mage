import { SCENARIO_NAMES, type ScenarioName } from './scenarios/names';

export interface RateLimits {
  /** Richieste al secondo per IP (briefing §3: RATE_GENERAL=10, RATE_AUTH=3, RATE_WS=1). */
  readonly general: number;
  readonly auth: number;
  readonly ws: number;
}

export interface MockConfig {
  readonly port: number;
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly reconnectTimeoutMs: number;
  readonly clockMs: number;
  readonly jwtTtlSeconds: number;
  readonly ticketTtlSeconds: number;
  readonly rateLimits: RateLimits | false;
  readonly corsOrigins: readonly string[];
  /** Ritardo delle azioni dei bot, per rendere l'ordine dei messaggi realistico. */
  readonly botDelayMs: number;
  readonly quiet: boolean;
}

export const DEFAULT_CONFIG: MockConfig = {
  port: 8080,
  scenario: 'pvp',
  seed: 42,
  reconnectTimeoutMs: 30_000,
  clockMs: 600_000,
  jwtTtlSeconds: 86_400,
  ticketTtlSeconds: 45,
  rateLimits: { general: 10, auth: 3, ws: 1 },
  // P0-2: origini che il server reale dovrà accettare.
  corsOrigins: ['http://localhost:5173', 'capacitor://localhost', 'http://localhost'],
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
  return {
    ...DEFAULT_CONFIG,
    port: intFromEnv('MOCK_PORT', DEFAULT_CONFIG.port),
    scenario,
    seed: intFromEnv('MOCK_SEED', DEFAULT_CONFIG.seed),
    reconnectTimeoutMs: intFromEnv('MOCK_RECONNECT_TIMEOUT_MS', DEFAULT_CONFIG.reconnectTimeoutMs),
    clockMs: intFromEnv('MOCK_CLOCK_MS', DEFAULT_CONFIG.clockMs),
    jwtTtlSeconds: intFromEnv('MOCK_JWT_TTL_S', DEFAULT_CONFIG.jwtTtlSeconds),
  };
}
