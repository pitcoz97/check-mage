import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiResult } from '../api/endpoints';
import type { Challenge, PresenceUpdate } from '../api/types';
import { createPresence, type VisibilitySource } from './presence';

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const challenge = (id: string): Challenge => ({
  id,
  from: { id: '8', username: 'luigi', elo: 1300 },
  to: { id: '7', username: 'mario', elo: 1200 },
  expiresInSeconds: 60,
});

function setup(replies: ApiResult<PresenceUpdate>[] = []) {
  const sendPresence = vi.fn(async (): Promise<ApiResult<PresenceUpdate>> => replies.shift() ?? { ok: true, value: { incoming: [] } });
  let hidden = false;
  const listeners = new Set<() => void>();
  const visibility: VisibilitySource = {
    isHidden: () => hidden,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
  const setHidden = (value: boolean) => {
    hidden = value;
    listeners.forEach((listener) => listener());
  };
  const presence = createPresence({ sendPresence, intervalMs: 10_000, visibility, now: () => 1_000 });
  return { presence, sendPresence, setHidden, listeners };
}

describe('presenza', () => {
  it('segnale subito e ogni 10 s; le sfide ricevute finiscono nello store', async () => {
    const { presence, sendPresence } = setup([{ ok: true, value: { incoming: [challenge('a')] } }]);
    presence.start();
    await flush();
    expect(sendPresence).toHaveBeenCalledTimes(1);
    expect(presence.store.getState()).toEqual({ incoming: [challenge('a')], receivedAt: 1_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendPresence).toHaveBeenCalledTimes(2);
    expect(presence.store.getState().incoming).toEqual([]);
    presence.stop();
  });

  it('con la pagina nascosta si ferma, al ritorno riparte subito', async () => {
    const { presence, sendPresence, setHidden } = setup();
    presence.start();
    await flush();
    setHidden(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendPresence).toHaveBeenCalledTimes(1);
    setHidden(false);
    await flush();
    expect(sendPresence).toHaveBeenCalledTimes(2);
    presence.stop();
  });

  it('una sfida a cui si è risposto non torna finché il server la manda; stop azzera e smette di ascoltare', async () => {
    const open = { ok: true, value: { incoming: [challenge('a')] } } as const;
    const { presence, sendPresence, listeners } = setup([open, open, { ok: true, value: { incoming: [] } }, open]);
    presence.start();
    await flush();
    presence.dismiss('a');
    expect(presence.store.getState().incoming).toEqual([]);
    await presence.refresh();
    expect(presence.store.getState().incoming).toEqual([]);
    // Il server non la manda più: se ricompare è una sfida nuova con lo stesso id (non succede, ma non va nascosta).
    await presence.refresh();
    await presence.refresh();
    expect(presence.store.getState().incoming).toEqual([challenge('a')]);

    presence.stop();
    expect(presence.store.getState()).toEqual({ incoming: [], receivedAt: null });
    expect(listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendPresence).toHaveBeenCalledTimes(4);
  });

  it('un errore di rete lascia lo stato com’era', async () => {
    const { presence } = setup([
      { ok: true, value: { incoming: [challenge('a')] } },
      { ok: false, error: { status: 0, code: 'network_error' } },
    ]);
    presence.start();
    await flush();
    await presence.refresh();
    expect(presence.store.getState().incoming).toEqual([challenge('a')]);
    presence.stop();
  });
});
