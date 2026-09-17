import { describe, expect, it } from 'vitest';

import { httpErrorSamples, wsErrorSamples } from '../mock-server/serverTexts';
import { decodeServerMessage, interpretHttpResponse } from '../src/api/adapter';

/**
 * Controllo incrociato: i testi d'errore copiati da chess-server nel mock devono essere tutti riconosciuti
 * dall'adapter, e con lo stesso codice che il mock esporrebbe con P1-3. Se il server cambia un testo,
 * vanno aggiornati entrambi i lati (ASSUMPTIONS C4).
 */
describe('testi d’errore del server ↔ adapter', () => {
  it.each(wsErrorSamples().map((t) => [t.message, t.code] as const))('WS "%s" → %s', (message, code) => {
    const result = decodeServerMessage(JSON.stringify({ type: 'error', payload: { message } }));
    expect(result.ok && result.event.type === 'error' ? result.event.error.code : 'fallita').toBe(code);
  });

  it.each(httpErrorSamples().map((t) => [t.message, t.code] as const))('HTTP "%s" → %s', (message, code) => {
    const outcome = interpretHttpResponse(400, JSON.stringify({ success: false, error: message }));
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe(code);
  });
});
