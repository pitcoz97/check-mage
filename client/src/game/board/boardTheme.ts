import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { STORAGE_KEYS, storage, type KeyValueStorage } from '../../lib/storage';

/**
 * Tema della scacchiera (REDESIGN_PLAN.md §10, D1): i tre del design, arcano di default. È una preferenza
 * dell'utente, salvata con `storage.ts`; i colori stanno in `tokens.css` sotto `[data-board-theme]`.
 */

export const BOARD_THEMES = ['arcano', 'salvia', 'noce'] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];
export const DEFAULT_BOARD_THEME: BoardTheme = 'arcano';

export function isBoardTheme(value: unknown): value is BoardTheme {
  return typeof value === 'string' && (BOARD_THEMES as readonly string[]).includes(value);
}

export interface BoardThemeState {
  readonly theme: BoardTheme;
  /** Legge la preferenza salvata; un valore sconosciuto vale come il default. */
  load(): Promise<void>;
  set(theme: BoardTheme): Promise<void>;
}

export function createBoardThemeStore(store: KeyValueStorage): StoreApi<BoardThemeState> {
  return createStore<BoardThemeState>()((set) => ({
    theme: DEFAULT_BOARD_THEME,
    async load() {
      const saved = await store.get(STORAGE_KEYS.boardTheme);
      set({ theme: isBoardTheme(saved) ? saved : DEFAULT_BOARD_THEME });
    },
    async set(theme) {
      set({ theme });
      await store.set(STORAGE_KEYS.boardTheme, theme);
    },
  }));
}

export const boardThemeStore = createBoardThemeStore(storage);

export function useBoardTheme(): BoardTheme {
  return useStore(boardThemeStore, (state) => state.theme);
}
