import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiResult } from '../api/endpoints';
import type { Challenge, PresenceUpdate } from '../api/types';

/**
 * Presenza (ASSUMPTIONS F2): mentre l'app è aperta e in primo piano il client manda `POST /me/presence` ogni
 * `PRESENCE_INTERVAL_MS`; la risposta porta le sfide ricevute ancora aperte. Con la pagina nascosta il segnale si
 * ferma, e dopo 30 s il server considera l'utente offline.
 */
export const PRESENCE_INTERVAL_MS = 10_000;

export interface PresenceState {
  /** Sfide ricevute ancora aperte, tolte quelle a cui si è già risposto da qui. */
  readonly incoming: readonly Challenge[];
  /** Istante dell'ultima risposta: serve al tempo residuo delle sfide. */
  readonly receivedAt: number | null;
}

/** Sorgente della visibilità della pagina (di default `document`); i test ne iniettano una finta. */
export interface VisibilitySource {
  isHidden(): boolean;
  subscribe(onChange: () => void): () => void;
}

export interface PresenceDeps {
  readonly sendPresence: () => Promise<ApiResult<PresenceUpdate>>;
  readonly intervalMs?: number;
  readonly visibility?: VisibilitySource | null;
  readonly now?: () => number;
}

export interface Presence {
  readonly store: StoreApi<PresenceState>;
  start(): void;
  stop(): void;
  /** Manda subito il segnale (dopo una sfida, o per aggiornare le sfide in arrivo). */
  refresh(): Promise<void>;
  /** La sfida ha già una risposta (accettata o rifiutata): non va più mostrata. */
  dismiss(challengeId: string): void;
}

const documentVisibility: VisibilitySource | null =
  typeof document === 'undefined'
    ? null
    : {
        isHidden: () => document.visibilityState === 'hidden',
        subscribe(onChange) {
          document.addEventListener('visibilitychange', onChange);
          return () => document.removeEventListener('visibilitychange', onChange);
        },
      };

export function createPresence(deps: PresenceDeps): Presence {
  const intervalMs = deps.intervalMs ?? PRESENCE_INTERVAL_MS;
  const visibility = deps.visibility === undefined ? documentVisibility : deps.visibility;
  const now = deps.now ?? Date.now;
  const store = createStore<PresenceState>()(() => ({ incoming: [], receivedAt: null }));
  const dismissed = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;

  async function refresh(): Promise<void> {
    const result = await deps.sendPresence();
    if (!running || !result.ok) return;
    const open = new Set(result.value.incoming.map((c) => c.id));
    for (const id of dismissed) if (!open.has(id)) dismissed.delete(id);
    store.setState({ incoming: result.value.incoming.filter((c) => !dismissed.has(c.id)), receivedAt: now() });
  }

  function stopTimer(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function startTimer(): void {
    stopTimer();
    void refresh();
    timer = setInterval(() => void refresh(), intervalMs);
  }

  function onVisibility(): void {
    if (visibility?.isHidden() === true) stopTimer();
    else startTimer();
  }

  return {
    store,
    refresh,

    start() {
      if (running) return;
      running = true;
      unsubscribe = visibility?.subscribe(onVisibility) ?? null;
      if (visibility?.isHidden() !== true) startTimer();
    },

    stop() {
      running = false;
      stopTimer();
      unsubscribe?.();
      unsubscribe = null;
      store.setState({ incoming: [], receivedAt: null });
    },

    dismiss(challengeId) {
      dismissed.add(challengeId);
      store.setState((s) => ({ incoming: s.incoming.filter((c) => c.id !== challengeId) }));
    },
  };
}
