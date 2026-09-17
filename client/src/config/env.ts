/**
 * Unico punto che legge la configurazione del bundle. Solo variabili `VITE_*`, nessun segreto (briefing §2.3).
 */

export interface AppEnv {
  readonly apiBaseUrl: string;
  readonly wsUrl: string;
}

type RawEnv = Partial<Record<'VITE_API_BASE_URL' | 'VITE_WS_URL', string>>;

export function readEnv(raw: RawEnv): AppEnv {
  const missing = (['VITE_API_BASE_URL', 'VITE_WS_URL'] as const).filter((key) => (raw[key] ?? '') === '');
  if (missing.length > 0) {
    throw new Error(`Configurazione mancante: ${missing.join(', ')}. Copia .env.example in .env.`);
  }
  return { apiBaseUrl: raw.VITE_API_BASE_URL ?? '', wsUrl: raw.VITE_WS_URL ?? '' };
}

/** Letta alla prima richiesta, così i moduli che non usano la rete non falliscono senza `.env`. */
export function appEnv(): AppEnv {
  return readEnv(import.meta.env);
}
