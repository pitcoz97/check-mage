import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { BOT_LEVELS, type BotLevel } from '../../game/model';
import { STORAGE_KEYS, storage, type KeyValueStorage } from '../../lib/storage';
import { BOT_COLOR_CHOICES, type BotColorChoice } from '../../store/matchSession';

/**
 * Le scelte della card «Gioca» (B…): modalità, e contro il bot livello e colore. Sono una comodità di chi gioca,
 * ricordata sul dispositivo con `storage.ts`; un valore salvato non valido vale come il default.
 */

export const PLAY_MODES = ['ranked', 'bot'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];

export interface PlayChoice {
  readonly mode: PlayMode;
  readonly level: BotLevel;
  readonly color: BotColorChoice;
}

export const DEFAULT_PLAY_CHOICE: PlayChoice = { mode: 'ranked', level: 'base', color: 'random' };

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

/** Legge la scelta salvata; i campi mancanti o sconosciuti prendono il default. */
export function parsePlayChoice(raw: string | null): PlayChoice {
  if (raw === null) return DEFAULT_PLAY_CHOICE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PLAY_CHOICE;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_PLAY_CHOICE;
  const record = value as Record<string, unknown>;
  return {
    mode: oneOf(PLAY_MODES, record['mode']) ? record['mode'] : DEFAULT_PLAY_CHOICE.mode,
    level: oneOf(BOT_LEVELS, record['level']) ? record['level'] : DEFAULT_PLAY_CHOICE.level,
    color: oneOf(BOT_COLOR_CHOICES, record['color']) ? record['color'] : DEFAULT_PLAY_CHOICE.color,
  };
}

export interface PlayChoiceState {
  readonly choice: PlayChoice;
  readonly loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<PlayChoice>): Promise<void>;
}

export function createPlayChoiceStore(store: KeyValueStorage): StoreApi<PlayChoiceState> {
  return createStore<PlayChoiceState>()((set, get) => ({
    choice: DEFAULT_PLAY_CHOICE,
    loaded: false,
    async load() {
      const saved = await store.get(STORAGE_KEYS.playChoice);
      // Una scelta fatta mentre si leggeva vince su quella salvata.
      if (!get().loaded) set({ choice: parsePlayChoice(saved), loaded: true });
    },
    async update(patch) {
      const choice = { ...get().choice, ...patch };
      set({ choice, loaded: true });
      await store.set(STORAGE_KEYS.playChoice, JSON.stringify(choice));
    },
  }));
}

export const playChoiceStore = createPlayChoiceStore(storage);

export function usePlayChoice(): PlayChoice {
  return useStore(playChoiceStore, (state) => state.choice);
}
