import { isNative } from '../platform/native';

/**
 * Unica astrazione di persistenza del client (CLAUDE.md): i componenti non toccano mai `localStorage`.
 *
 * Due implementazioni dietro la stessa interfaccia asincrona: `localStorage` sul web (ASSUMPTIONS C7) e
 * `@capacitor/preferences` su dispositivo, cioè lo storage di sistema invece della WebView. Nessuna delle due
 * lancia: storage bloccato, pieno o assente equivale a "nessun valore".
 */

export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const PREFIX = 'checkmage:';

export function createWebStorage(backend: () => Storage | undefined = () => globalThis.localStorage): KeyValueStorage {
  const safely = <T>(fallback: T, action: (s: Storage) => T): T => {
    try {
      const s = backend();
      return s === undefined ? fallback : action(s);
    } catch {
      return fallback;
    }
  };
  return {
    get: async (key) => safely(null, (s) => s.getItem(PREFIX + key)),
    set: async (key, value) => safely(undefined, (s) => s.setItem(PREFIX + key, value)),
    remove: async (key) => safely(undefined, (s) => s.removeItem(PREFIX + key)),
  };
}

/** Il poco di `@capacitor/preferences` che serve qui: nei test si inietta un finto, senza toccare il nativo. */
export interface PreferencesLike {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

/**
 * Storage di sistema su dispositivo. Il plugin arriva da una funzione asincrona, così sul web non viene mai
 * caricato: `storage` lo chiede solo quando `isNative()` è vero.
 */
export function createNativeStorage(load: () => Promise<PreferencesLike>): KeyValueStorage {
  async function safely<T>(fallback: T, action: (preferences: PreferencesLike) => Promise<T>): Promise<T> {
    try {
      return await action(await load());
    } catch {
      return fallback;
    }
  }
  return {
    get: (key) => safely<string | null>(null, async (p) => (await p.get({ key: PREFIX + key })).value ?? null),
    set: (key, value) => safely(undefined, async (p) => p.set({ key: PREFIX + key, value })),
    remove: (key) => safely(undefined, async (p) => p.remove({ key: PREFIX + key })),
  };
}

/** Chiavi note, per evitare stringhe sparse. */
export const STORAGE_KEYS = {
  language: 'language',
  session: 'session',
  /** Id dell'utente con una partita aperta, per riprenderla dopo un ricaricamento (ASSUMPTIONS C11). */
  activeMatch: 'active-match',
} as const;

export const storage: KeyValueStorage = isNative()
  ? createNativeStorage(async () => (await import('@capacitor/preferences')).Preferences)
  : createWebStorage();
