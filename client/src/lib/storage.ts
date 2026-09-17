/**
 * Unica astrazione di persistenza del client (CLAUDE.md): i componenti non toccano mai `localStorage`.
 *
 * Interfaccia asincrona perché allo Step 6 su mobile si userà `@capacitor/preferences`, che è asincrono.
 * Oggi c'è solo l'implementazione web. Non lancia mai: storage bloccato o pieno equivale a "nessun valore".
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

/** Chiavi note, per evitare stringhe sparse. */
export const STORAGE_KEYS = {
  language: 'language',
} as const;

export const storage: KeyValueStorage = createWebStorage();
