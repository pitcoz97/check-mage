/**
 * Unico punto che legge la configurazione del bundle. Solo variabili `VITE_*`, nessun segreto (briefing §2.3).
 *
 * La validazione è severa apposta: puntando a un server vero gli errori tipici (manca lo schema, `ws://` scambiato
 * con `http://`, una barra di troppo) diventerebbero altrimenti fallimenti oscuri dentro la connessione.
 */

export interface AppEnv {
  readonly apiBaseUrl: string;
  readonly wsUrl: string;
}

type RawEnv = Partial<Record<'VITE_API_BASE_URL' | 'VITE_WS_URL', string>>;

/** `http://host[:porta][/prefisso]`, senza barra finale (la aggiungono i path delle richieste). */
function checkApiBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `VITE_API_BASE_URL non è un indirizzo assoluto: "${value}". Esempio: http://localhost:8080`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `VITE_API_BASE_URL deve iniziare con http:// o https://: "${value}"`;
  if (value.endsWith('/')) return 'VITE_API_BASE_URL non deve finire con "/"';
  return null;
}

/** `ws://host[:porta]/ws`: il ticket viene aggiunto come parametro, quindi il path deve già essere quello giusto. */
function checkWsUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `VITE_WS_URL non è un indirizzo assoluto: "${value}". Esempio: ws://localhost:8080/ws`;
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return `VITE_WS_URL deve iniziare con ws:// o wss://: "${value}". Con un'API in https serve wss.`;
  }
  if (url.pathname === '/' || url.pathname === '') return `VITE_WS_URL deve includere il path del WebSocket: "${value}/ws"`;
  return null;
}

export function readEnv(raw: RawEnv): AppEnv {
  const apiBaseUrl = raw.VITE_API_BASE_URL ?? '';
  const wsUrl = raw.VITE_WS_URL ?? '';
  const missing = (['VITE_API_BASE_URL', 'VITE_WS_URL'] as const).filter((key) => (raw[key] ?? '') === '');
  if (missing.length > 0) {
    throw new Error(`Configurazione mancante: ${missing.join(', ')}. Copia .env.example in .env.`);
  }
  const problems = [checkApiBaseUrl(apiBaseUrl), checkWsUrl(wsUrl)].filter((problem) => problem !== null);
  // Pagina servita in https e WebSocket in chiaro: il browser lo blocca, meglio dirlo qui.
  if (apiBaseUrl.startsWith('https://') && wsUrl.startsWith('ws://')) {
    problems.push('VITE_WS_URL è in chiaro (ws://) mentre l’API è in https: il browser bloccherebbe la connessione.');
  }
  if (problems.length > 0) throw new Error(`Configurazione non valida.\n- ${problems.join('\n- ')}`);
  return { apiBaseUrl, wsUrl };
}

/** Letta alla prima richiesta, così i moduli che non usano la rete non falliscono senza `.env`. */
export function appEnv(): AppEnv {
  return readEnv(import.meta.env);
}
