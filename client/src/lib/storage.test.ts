import { describe, expect, it, vi } from 'vitest';

import { createNativeStorage, createWebStorage, type PreferencesLike } from './storage';

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('storage', () => {
  it('legge, scrive e rimuove con un prefisso di namespace', async () => {
    const backend = new MemoryStorage();
    const storage = createWebStorage(() => backend);
    expect(await storage.get('language')).toBeNull();
    await storage.set('language', 'en');
    expect(await storage.get('language')).toBe('en');
    expect(backend.getItem('checkmage:language')).toBe('en');
    await storage.remove('language');
    expect(await storage.get('language')).toBeNull();
  });

  it('uno storage bloccato o assente non rompe nulla', async () => {
    const throwing = createWebStorage(() => {
      throw new Error('SecurityError');
    });
    await expect(throwing.set('k', 'v')).resolves.toBeUndefined();
    await expect(throwing.get('k')).resolves.toBeNull();
    const missing = createWebStorage(() => undefined);
    await expect(missing.get('k')).resolves.toBeNull();
  });
});

/** Finto `@capacitor/preferences`: stessa forma del plugin, in memoria. */
function fakePreferences(): PreferencesLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async ({ key }) => ({ value: map.get(key) ?? null }),
    set: async ({ key, value }) => void map.set(key, value),
    remove: async ({ key }) => void map.delete(key),
  };
}

describe('storage nativo', () => {
  it('usa il plugin di sistema con lo stesso prefisso del web', async () => {
    const preferences = fakePreferences();
    const storage = createNativeStorage(async () => preferences);
    expect(await storage.get('session')).toBeNull();
    await storage.set('session', '{"accessToken":"a1"}');
    expect(preferences.map.get('checkmage:session')).toBe('{"accessToken":"a1"}');
    expect(await storage.get('session')).toBe('{"accessToken":"a1"}');
    await storage.remove('session');
    expect(await storage.get('session')).toBeNull();
  });

  it('il plugin si carica una volta sola, e solo quando serve', async () => {
    const preferences = fakePreferences();
    const load = vi.fn(async () => preferences);
    const storage = createNativeStorage(load);
    expect(load).not.toHaveBeenCalled();
    await storage.set('language', 'it');
    await storage.get('language');
    // Il caricamento è dinamico: viene chiesto a ogni operazione, ma è lo stesso modulo già in cache.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('un plugin che non risponde vale come "nessun valore", non come errore', async () => {
    const broken = createNativeStorage(() => Promise.reject(new Error('plugin non disponibile')));
    await expect(broken.get('session')).resolves.toBeNull();
    await expect(broken.set('session', 'x')).resolves.toBeUndefined();
    await expect(broken.remove('session')).resolves.toBeUndefined();
  });
});
