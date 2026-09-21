import { describe, expect, it } from 'vitest';

import { createLogger, type LogLevel } from '../lib/log';
import { createMatchStore } from '../store/matchStore';
import { routeFrame } from './dispatch';

function setup() {
  const entries: { level: LogLevel; message: string }[] = [];
  const logger = createLogger((level, message) => entries.push({ level, message }));
  const store = createMatchStore('1', () => 0);
  return { entries, logger, store };
}

describe('routeFrame', () => {
  it('evento valido → applicato dal reducer', () => {
    const { logger, store } = setup();
    expect(routeFrame(JSON.stringify({ type: 'opponent_disconnected', payload: { message: 'x' } }), store.getState(), logger).ok).toBe(true);
    expect(store.getState().opponentConnected).toBe(false);
  });

  it('type sconosciuto, JSON invalido, payload malformato → no-op loggato, stato identico', () => {
    const { entries, logger, store } = setup();
    const before = store.getState();
    for (const raw of ['{"type":"chat_message","payload":{}}', '{not json', '{"type":"hand","payload":{"hand":"spark"}}']) {
      expect(routeFrame(raw, store.getState(), logger).ok).toBe(false);
    }
    expect(store.getState()).toBe(before);
    expect(entries.map((e) => e.message)).toEqual([
      'frame del server ignorato: unknown_type',
      'frame del server ignorato: invalid_json',
      'frame del server ignorato: malformed_payload',
    ]);
    expect(entries.every((e) => e.level === 'warn')).toBe(true);
  });

  it('i warning dell’adapter finiscono nel log con l’id dell’assunzione', () => {
    const { entries, logger, store } = setup();
    routeFrame(JSON.stringify({ type: 'error', payload: { message: 'nuovo errore' } }), store.getState(), logger);
    expect(entries.map((e) => e.message)).toEqual(['adapter [G6] error_code_missing']);
    expect(store.getState().lastError?.info.code).toBeNull();
  });
});
