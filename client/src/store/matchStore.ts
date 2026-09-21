import { createStore, type StoreApi } from 'zustand/vanilla';

import type {
  ActiveEffect,
  AppliedEffect,
  Clocks,
  Color,
  GameOverReason,
  GameResult,
  HandCard,
  PerColor,
  ProtocolErrorInfo,
  PublicGameState,
  SquareEffects,
  UserId,
  Username,
} from '../game/model';
import { assertNever, type DrawDeclineReason, type ServerEvent } from '../ws/protocol';

/**
 * Stato di partita: l'unica fonte sono gli eventi del server, applicati da `applyServerEvent` (briefing §8).
 * Nessun componente muta questo stato; nessuna regola di gioco viene ricalcolata qui.
 */

export type MatchLifecycle = 'idle' | 'queued' | 'playing' | 'over';

/** Ultimo valore degli orologi ricevuto e l'istante di ricezione: base dell'interpolazione (`clockRemaining`). */
export interface ClockSync {
  readonly clocks: Clocks;
  /** Giocatore di cui scorre il tempo (il giocatore attivo, `game/room.go:1279-1327`). */
  readonly turn: Color | 'unknown';
  readonly at: number;
}

export interface GameOutcome {
  readonly result: GameResult;
  readonly reason: GameOverReason;
  readonly winner: Username | null;
}

export interface MatchState {
  readonly lifecycle: MatchLifecycle;
  /** Id dell'utente di questa sessione (`/me`): serve a riconoscere il proprio colore. */
  readonly selfId: UserId | null;
  readonly game: PublicGameState | null;
  /** Da `white_player`/`black_player` confrontati con `selfId`: mai dedotto (ASSUMPTIONS C1). */
  readonly myColor: Color | null;
  readonly hand: readonly HandCard[];
  readonly myDeckSize: number | null;
  readonly clockSync: ClockSync | null;
  /** `incoming`: l'avversario ha offerto patta; `outgoing`: la mia offerta è pendente. */
  readonly drawOffer: { readonly incoming: boolean; readonly outgoing: boolean };
  /** Esito della mia ultima offerta, per un avviso una tantum. */
  readonly drawNotice: { readonly reason: DrawDeclineReason; readonly seq: number } | null;
  readonly opponentConnected: boolean;
  readonly lastError: { readonly info: ProtocolErrorInfo; readonly seq: number } | null;
  readonly outcome: GameOutcome | null;
  /** Numero di eventi applicati: rende distinguibili avvisi ed errori uguali e consecutivi. */
  readonly seq: number;
}

export function initialMatchState(selfId: UserId | null): MatchState {
  return {
    lifecycle: 'idle',
    selfId,
    game: null,
    myColor: null,
    hand: [],
    myDeckSize: null,
    clockSync: null,
    drawOffer: { incoming: false, outgoing: false },
    drawNotice: null,
    opponentConnected: true,
    lastError: null,
    outcome: null,
    seq: 0,
  };
}

// ---------------------------------------------------------------------------------------------------
// Supporto
// ---------------------------------------------------------------------------------------------------

const withColor = <T>(values: PerColor<T>, color: Color, value: T): PerColor<T> => ({ ...values, [color]: value });

/** Tempo residuo del giocatore all'istante `now`: scorre solo quello di `clockSync.turn`, mai sotto zero. */
export function clockRemaining(sync: ClockSync | null, color: Color, now: number): number | null {
  if (sync === null) return null;
  const base = sync.clocks[color];
  return sync.turn === color ? Math.max(0, base - Math.max(0, now - sync.at)) : base;
}

/** Riancora l'interpolazione a `at` con un nuovo giocatore attivo (il server lo fa scorrere da quel momento). */
function reanchorClock(sync: ClockSync | null, turn: Color, at: number): ClockSync | null {
  if (sync === null) return null;
  return {
    clocks: { white: clockRemaining(sync, 'white', at) ?? 0, black: clockRemaining(sync, 'black', at) ?? 0 },
    turn,
    at,
  };
}

/**
 * Riconciliazione della mano (ASSUMPTIONS C5): il server identifica le carte solo per `spell_id`, quindi a ogni
 * `hand` si riusano gli id d'istanza locali delle carte già note con lo stesso `spell_id`. Così il rendering resta
 * stabile (nessuna carta "nuova" per il solo rientro).
 */
export function reconcileHand(previous: readonly HandCard[], incoming: readonly HandCard[]): HandCard[] {
  const available = [...previous];
  return incoming.map((card) => {
    const index = available.findIndex((known) => known.spellId === card.spellId);
    if (index < 0) return card;
    const [known] = available.splice(index, 1);
    return known ?? card;
  });
}

/**
 * Stato persistente prodotto da un effetto dichiarato in `spell_cast` (spazi distinti, ASSUMPTIONS A18):
 * `effects/tracker.go:9-13`, `game/room.go:778-800`. Il server non manda un `game_state` dopo freeze e shield
 * (la scacchiera non cambia), quindi l'effetto dichiarato va applicato qui — senza ricalcolarlo (G8).
 */
const PERSISTENT_STATE_OF: Partial<Record<AppliedEffect['kind'], string>> = {
  freeze_piece: 'freeze',
  shield_piece: 'shield',
};

function upsertEffect(effects: readonly SquareEffects[], square: SquareEffects['square'], effect: ActiveEffect): SquareEffects[] {
  const entry = effects.find((e) => e.square === square);
  if (entry === undefined) return [...effects, { square, effects: [effect] }];
  return effects.map((e) =>
    e.square === square ? { square, effects: [...e.effects.filter((x) => x.kind !== effect.kind), effect] } : e,
  );
}

function removeEffect(effects: readonly SquareEffects[], square: SquareEffects['square'], kind: string): SquareEffects[] {
  return effects
    .map((e) => (e.square === square ? { square, effects: e.effects.filter((x) => x.kind !== kind) } : e))
    .filter((e) => e.effects.length > 0);
}

function colorOf(game: PublicGameState, selfId: UserId | null): Color | null {
  if (game.players === null || selfId === null) return null;
  if (game.players.white.id === selfId) return 'white';
  if (game.players.black.id === selfId) return 'black';
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------------------

/** Applica un evento del server. Pura: `receivedAt` è l'istante di ricezione, usato solo per gli orologi. */
export function applyServerEvent(state: MatchState, event: ServerEvent, receivedAt: number): MatchState {
  // Dopo `game_over` gli eventi di partita non contano più (difesa: il server ne manda uno solo, B1); un `error`
  // resta visibile, per esempio il rifiuto di un'azione arrivata tardi.
  if (state.lifecycle === 'over' && event.type !== 'error') return state;

  const seq = state.seq + 1;
  const base = { ...state, seq };
  const { game } = state;

  switch (event.type) {
    case 'game_state': {
      const next = event.state;
      const myColor = colorOf(next, state.selfId) ?? state.myColor;
      // Chi ha ricevuto un'offerta di patta non viene avvisato quando decade per la propria mossa
      // (`game/room.go:503-508`): la si scarta quando lo stato mostra una mossa giocata con il proprio tratto.
      const movedByMe = game !== null && myColor !== null && game.turn === myColor && next.moves.length > game.moves.length;
      return {
        ...base,
        lifecycle: 'playing',
        game: next,
        myColor,
        myDeckSize: myColor === null ? state.myDeckSize : next.deckSizes[myColor],
        clockSync: {
          clocks: next.clocks,
          turn: next.activePlayer,
          at: receivedAt,
        },
        drawOffer: movedByMe ? { ...state.drawOffer, incoming: false } : state.drawOffer,
      };
    }

    case 'hand': {
      const hand = reconcileHand(state.hand, event.hand.cards);
      const me = state.myColor;
      return {
        ...base,
        hand,
        myDeckSize: event.hand.deckSize,
        game:
          game === null || me === null
            ? game
            : {
                ...game,
                mana: withColor(game.mana, me, event.hand.mana),
                handSizes: withColor(game.handSizes, me, hand.length),
                deckSizes: withColor(game.deckSizes, me, event.hand.deckSize),
              },
      };
    }

    case 'card_drawn': {
      const me = state.myColor;
      const deckSize = event.deckSize ?? state.myDeckSize;
      return {
        ...base,
        hand: [...state.hand, event.card],
        myDeckSize: deckSize,
        game: game === null || me === null || deckSize === null ? game : { ...game, deckSizes: withColor(game.deckSizes, me, deckSize) },
      };
    }

    case 'hand_size_changed':
      return game === null ? base : { ...base, game: { ...game, handSizes: withColor(game.handSizes, event.player, event.size) } };

    case 'mana_changed':
      return game === null ? base : { ...base, game: { ...game, mana: withColor(game.mana, event.player, event.mana) } };

    case 'phase_changed':
      return {
        ...base,
        game: game === null ? game : { ...game, phase: event.phase, activePlayer: event.activePlayer, turnNumber: event.turnNumber },
        clockSync: reanchorClock(state.clockSync, event.activePlayer, receivedAt),
      };

    case 'spell_cast': {
      let hand = state.hand;
      if (event.player === state.myColor) {
        // Il server non rimanda `hand` dopo un cast: la carta giocata si toglie qui (una sola copia).
        const index = hand.findIndex((card) => card.spellId === event.spellId);
        if (index >= 0) hand = [...hand.slice(0, index), ...hand.slice(index + 1)];
      }
      let activeEffects = game?.activeEffects ?? [];
      for (const effect of event.effects) {
        const kind = PERSISTENT_STATE_OF[effect.kind];
        if (kind === undefined || !('target' in effect)) continue;
        const remainingTurns = 'remainingTurns' in effect ? effect.remainingTurns : 1;
        activeEffects = upsertEffect(activeEffects, effect.target, { kind, remainingTurns, sourceSpellId: event.spellId });
      }
      return { ...base, hand, game: game === null ? game : { ...game, activeEffects } };
    }

    case 'effect_expired':
      return game === null
        ? base
        : { ...base, game: { ...game, activeEffects: removeEffect(game.activeEffects, event.expired.square, event.expired.kind) } };

    case 'timer_update':
      return {
        ...base,
        game: game === null ? game : { ...game, clocks: event.clocks },
        clockSync: { clocks: event.clocks, turn: event.turn, at: receivedAt },
      };

    case 'game_over':
      return {
        ...base,
        lifecycle: 'over',
        outcome: { result: event.result, reason: event.reason, winner: event.winner },
        drawOffer: { incoming: false, outgoing: false },
        // Gli orologi si fermano: il valore resta quello dell'ultimo aggiornamento.
        clockSync: state.clockSync === null ? null : { ...state.clockSync, turn: 'unknown' },
      };

    case 'error':
      return { ...base, lastError: { info: event.error, seq } };

    case 'draw_offer':
      return { ...base, drawOffer: { ...state.drawOffer, incoming: true } };

    case 'draw_offer_sent':
      return { ...base, drawOffer: { ...state.drawOffer, outgoing: true } };

    case 'draw_declined':
      return { ...base, drawOffer: { ...state.drawOffer, outgoing: false }, drawNotice: { reason: event.reason, seq } };

    case 'opponent_disconnected':
      return { ...base, opponentConnected: false };

    case 'opponent_reconnected':
      return { ...base, opponentConnected: true };

    default:
      return assertNever(event);
  }
}

// ---------------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------------

export interface MatchStoreState extends MatchState {
  dispatch(event: ServerEvent, receivedAt?: number): void;
  /** Nuova ricerca: stato pulito, in coda. */
  enterQueue(): void;
  /** Stato pulito (uscita dalla partita, cambio utente). */
  reset(selfId: UserId | null): void;
}

export function createMatchStore(selfId: UserId | null, now: () => number = Date.now): StoreApi<MatchStoreState> {
  return createStore<MatchStoreState>()((set, get) => ({
    ...initialMatchState(selfId),
    dispatch(event, receivedAt = now()) {
      set(applyServerEvent(get(), event, receivedAt));
    },
    enterQueue() {
      set({ ...initialMatchState(get().selfId), lifecycle: 'queued' });
    },
    reset(nextSelfId) {
      set(initialMatchState(nextSelfId));
    },
  }));
}
