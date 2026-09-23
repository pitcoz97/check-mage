import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../lib/log';
import { isNative, nativeAppEvents, type AppPlugin } from './native';

/**
 * Confine nativo: riconoscimento della piattaforma dal ponte iniettato nella WebView, e adattamento degli eventi
 * di ciclo di vita. Il plugin è finto: qui non c'è nessun dispositivo.
 */

const globals = globalThis as { Capacitor?: unknown };

afterEach(() => {
  delete globals.Capacitor;
});

/** Finto `@capacitor/app`: registra i listener e permette di simulare background e ripresa. */
function fakeApp() {
  const listeners = new Set<(state: { isActive: boolean }) => void>();
  const counts = { added: 0, removed: 0 };
  const plugin: AppPlugin = {
    addListener: async (_event, listener) => {
      counts.added++;
      listeners.add(listener);
      return {
        remove: async () => {
          counts.removed++;
          listeners.delete(listener);
        },
      };
    },
  };
  return { plugin, listeners, counts, emit: (isActive: boolean) => listeners.forEach((l) => l({ isActive })) };
}

const mute = createLogger(() => undefined);

describe('isNative', () => {
  it('senza ponte nella pagina è web', () => {
    expect(isNative()).toBe(false);
  });

  it('con il ponte della WebView è nativo, e un ponte rotto non fa esplodere nulla', () => {
    globals.Capacitor = { isNativePlatform: () => true };
    expect(isNative()).toBe(true);
    globals.Capacitor = { isNativePlatform: () => false };
    expect(isNative()).toBe(false);
    globals.Capacitor = {
      isNativePlatform: () => {
        throw new Error('ponte non pronto');
      },
    };
    expect(isNative()).toBe(false);
    globals.Capacitor = {};
    expect(isNative()).toBe(false);
  });
});

describe('eventi di ripresa dell’app', () => {
  it('chiama chi ascolta solo quando l’app torna in primo piano', async () => {
    const app = fakeApp();
    const onResume = vi.fn();
    const unsubscribe = nativeAppEvents(async () => app.plugin, mute).subscribe(onResume);
    await vi.waitFor(() => expect(app.listeners.size).toBe(1));

    app.emit(false); // va in background
    expect(onResume).not.toHaveBeenCalled();
    app.emit(true);
    expect(onResume).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.waitFor(() => expect(app.counts.removed).toBe(1));
    app.emit(true);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('disiscrizione prima che il plugin sia pronto: il listener non resta appeso', async () => {
    const app = fakeApp();
    const onResume = vi.fn();
    nativeAppEvents(async () => app.plugin, mute).subscribe(onResume)();
    await vi.waitFor(() => expect(app.counts.removed).toBe(1));
    expect(app.listeners.size).toBe(0);
    app.emit(true);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('plugin non disponibile: si logga e basta', async () => {
    const warn = vi.fn();
    const log = createLogger((level, message) => (level === 'warn' ? warn(message) : undefined));
    const unsubscribe = nativeAppEvents(() => Promise.reject(new Error('niente plugin')), log).subscribe(vi.fn());
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(unsubscribe).not.toThrow();
  });
});
