import { describe, expect, it } from 'vitest';

import { GAME_ERROR_CODES, httpErrorSamples, wsErrorSamples } from '../mock-server/serverTexts';
import { decodeServerMessage, interpretHttpResponse } from '../src/api/adapter';
import { PROTOCOL_ERROR_CODES } from '../src/game/model';

/**
 * Controllo incrociato tra gli errori copiati da chess-server nel mock e l'adapter del client.
 * - WebSocket: i codici di `gameerr/gameerr.go` coincidono, e ogni errore (con i suoi `details`) arriva normalizzato.
 * - REST: niente codici sul filo, quindi ogni testo va riconosciuto (ASSUMPTIONS C4).
 */
describe('errori del server ↔ adapter', () => {
  it('i codici WebSocket del server e quelli del client coincidono', () => {
    expect([...PROTOCOL_ERROR_CODES].sort()).toEqual([...GAME_ERROR_CODES].sort());
  });

  it.each(wsErrorSamples().map((e) => [e.message, e] as const))('WS "%s"', (_message, sample) => {
    const result = decodeServerMessage(JSON.stringify({ type: 'error', payload: sample }));
    expect(result.ok && result.event.type === 'error' ? result.event.error.code : 'fallita').toBe(sample.code);
    expect(result.ok ? result.warnings : 'fallita').toEqual([]);
    if (!result.ok || result.event.type !== 'error') return;
    const info = result.event.error;
    const details = sample.details ?? {};
    // Ogni dettaglio che la UI usa arriva normalizzato con lo stesso valore.
    for (const [wire, key] of [
      ['square', 'square'],
      ['phase', 'phase'],
      ['needed', 'needed'],
      ['available', 'available'],
      ['expected', 'expected'],
      ['received', 'received'],
      ['king', 'king'],
    ] as const) {
      expect(info[key]).toBe(details[wire] ?? null);
    }
  });

  it.each(httpErrorSamples().map((t) => [t.message, t.code] as const))('HTTP "%s" → %s', (message, code) => {
    const outcome = interpretHttpResponse(400, JSON.stringify({ success: false, error: message }));
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe(code);
  });
});
