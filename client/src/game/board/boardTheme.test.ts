import { describe, expect, it } from 'vitest';

import { createWebStorage, STORAGE_KEYS } from '../../lib/storage';
import { createBoardThemeStore, DEFAULT_BOARD_THEME } from './boardTheme';

/** Preferenza del tema della scacchiera (D1): default arcano, salvata, valori ignoti scartati. */

function memoryStorage() {
  const data = new Map<string, string>();
  const backend = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  } as unknown as Storage;
  return createWebStorage(() => backend);
}

describe('boardTheme', () => {
  it('parte da arcano e ci resta se non c’è nulla di salvato', async () => {
    const store = createBoardThemeStore(memoryStorage());
    expect(store.getState().theme).toBe(DEFAULT_BOARD_THEME);
    await store.getState().load();
    expect(store.getState().theme).toBe('arcano');
  });

  it('salva la scelta e la ritrova', async () => {
    const storage = memoryStorage();
    await createBoardThemeStore(storage).getState().set('noce');
    const reopened = createBoardThemeStore(storage);
    await reopened.getState().load();
    expect(reopened.getState().theme).toBe('noce');
  });

  it('un valore salvato sconosciuto vale come il default', async () => {
    const storage = memoryStorage();
    await storage.set(STORAGE_KEYS.boardTheme, 'rosa');
    const store = createBoardThemeStore(storage);
    await store.getState().load();
    expect(store.getState().theme).toBe('arcano');
  });
});
