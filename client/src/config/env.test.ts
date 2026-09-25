import { describe, expect, it } from 'vitest';

import { readEnv } from './env';

/** La configurazione è l'unica cosa che cambia fra mock e server vero: un errore qui deve dirsi subito. */

const valid = { VITE_API_BASE_URL: 'http://localhost:8080', VITE_WS_URL: 'ws://localhost:8080/ws' };

describe('configurazione', () => {
  it('accetta mock in chiaro e server in https', () => {
    expect(readEnv(valid)).toEqual({ apiBaseUrl: 'http://localhost:8080', wsUrl: 'ws://localhost:8080/ws' });
    expect(readEnv({ VITE_API_BASE_URL: 'https://api.checkmage.it', VITE_WS_URL: 'wss://api.checkmage.it/ws' }).wsUrl).toBe('wss://api.checkmage.it/ws');
    // Un prefisso di path sull'API è legittimo (reverse proxy).
    expect(readEnv({ VITE_API_BASE_URL: 'https://esempio.it/api', VITE_WS_URL: 'wss://esempio.it/api/ws' }).apiBaseUrl).toBe('https://esempio.it/api');
  });

  it('dice quali variabili mancano', () => {
    expect(() => readEnv({})).toThrow(/VITE_API_BASE_URL, VITE_WS_URL/);
    expect(() => readEnv({ VITE_API_BASE_URL: 'http://localhost:8080' })).toThrow(/VITE_WS_URL/);
  });

  it('rifiuta indirizzi che non sono assoluti o hanno lo schema sbagliato', () => {
    expect(() => readEnv({ ...valid, VITE_API_BASE_URL: 'localhost:8080' })).toThrow(/http:\/\/ o https:\/\//);
    expect(() => readEnv({ ...valid, VITE_API_BASE_URL: '/api' })).toThrow(/indirizzo assoluto/);
    expect(() => readEnv({ ...valid, VITE_API_BASE_URL: 'ws://localhost:8080' })).toThrow(/http:\/\/ o https:\/\//);
    expect(() => readEnv({ ...valid, VITE_WS_URL: 'http://localhost:8080/ws' })).toThrow(/ws:\/\/ o wss:\/\//);
    expect(() => readEnv({ ...valid, VITE_WS_URL: 'ws://localhost:8080' })).toThrow(/path del WebSocket/);
  });

  it('rifiuta la barra finale sull’API e il WebSocket in chiaro sotto https', () => {
    expect(() => readEnv({ ...valid, VITE_API_BASE_URL: 'http://localhost:8080/' })).toThrow(/non deve finire/);
    expect(() => readEnv({ VITE_API_BASE_URL: 'https://api.checkmage.it', VITE_WS_URL: 'ws://api.checkmage.it/ws' })).toThrow(/bloccherebbe/);
  });

  it('un indirizzo con parametri resta valido: lo scenario del mock si passa così', () => {
    expect(readEnv({ ...valid, VITE_WS_URL: 'ws://localhost:8080/ws?scenario=spellbook' }).wsUrl).toBe('ws://localhost:8080/ws?scenario=spellbook');
  });
});
