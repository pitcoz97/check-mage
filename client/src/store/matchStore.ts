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
  SpellId,
  RuneResult,
  Square,
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

export interface OptimisticMove {
  readonly from: Square;
  readonly to: Square;
  readonly at: number;
}

/** Cast mandato al server, in attesa di risposta: niente ottimismo, serve solo a non mandarlo due volte (G7). */
export interface PendingCast {
  readonly spellId: SpellId;
  readonly at: number;
}

/** Ultima magia risolta, come l'ha dichiarata il server (`spell_cast`): il client la anima, non la ricalcola (G8). */
export interface ResolvedSpell {
  readonly player: Color;
  /** `null` = magia nascosta dell'avversario (ASSUMPTIONS M42). */
  readonly spellId: SpellId | null;
  readonly targets: readonly Square[];
  readonly effects: readonly AppliedEffect[];
  readonly seq: number;
}

/**
 * Magia lanciata in questa sessione, per lo storico (REDESIGN_PLAN.md D11). `moveIndex` = mosse già giocate quando
 * è arrivata: dice dove intercalarla fra le mosse. Il server non rimanda le magie al rientro (P2-18): dopo un
 * ricaricamento il registro riparte vuoto.
 */
export interface LoggedSpell {
  readonly player: Color;
  /** `null` = magia nascosta dell'avversario: nel registro come "Magia nascosta". */
  readonly spellId: SpellId | null;
  readonly targets: readonly Square[];
  readonly moveIndex: number;
  readonly seq: number;
}

/** Ultima runa scattata (`rune_triggered`): la casa lampeggia e il box del suggerimento lo dice. */
export interface TriggeredRune {
  readonly square: Square;
  readonly owner: Color;
  readonly onEnter: string;
  readonly result: RuneResult;
  readonly seq: number;
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
  /**
   * Mossa propria mostrata prima della conferma (briefing §8): solo le caselle, nessuna FEN calcolata qui. Si azzera
   * al `game_state` successivo — che può anche smentirla, se uno scudo assorbe la cattura — o su `error`.
   */
  readonly optimistic: OptimisticMove | null;
  /** Cast in volo: la mano resta ferma finché il server non risponde. Mai un cambio di stato di gioco. */
  readonly pendingCast: PendingCast | null;
  readonly lastCast: ResolvedSpell | null;
  readonly lastRune: TriggeredRune | null;
  /** Magie viste in questa sessione, in ordine d'arrivo. */
  readonly spellLog: readonly LoggedSpell[];
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
    optimistic: null,
    pendingCast: null,
    lastCast: null,
    lastRune: null,
    spellLog: [],
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
  freeze_all: 'freeze',
  shield_area: 'shield',
  // I pezzi congelati attorno alle rune; le rune consumate spariscono con `square_effects_changed`.
  detonate_runes: 'freeze',
};

/** Le case su cui un effetto dichiarato lascia lo stato: una (`target`) o tante (`targets`, effetti di massa). */
function stateSquares(effect: AppliedEffect): readonly SquareEffects['square'][] {
  if ('target' in effect) return [effect.target];
  if ('targets' in effect) return effect.targets;
  return [];
}

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
        optimistic: null,
        // Valvola di sicurezza: uno stato nuovo vuol dire che il server ha già lavorato, il cast non è più in volo.
        pendingCast: null,
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
      if (event.player === state.myColor && event.spellId !== null) {
        // Il server non rimanda `hand` dopo un cast: la carta giocata si toglie qui (una sola copia). Una magia
        // nascosta è sempre dell'avversario: la mano non si tocca.
        const index = hand.findIndex((card) => card.spellId === event.spellId);
        if (index >= 0) hand = [...hand.slice(0, index), ...hand.slice(index + 1)];
      }
      let activeEffects = game?.activeEffects ?? [];
      for (const effect of event.effects) {
        const kind = PERSISTENT_STATE_OF[effect.kind];
        if (kind === undefined) continue;
        const remainingTurns = 'remainingTurns' in effect ? effect.remainingTurns : 1;
        for (const square of stateSquares(effect)) {
          activeEffects = upsertEffect(activeEffects, square, { kind, remainingTurns, sourceSpellId: event.spellId });
        }
      }
      return {
        ...base,
        hand,
        game: game === null ? game : { ...game, activeEffects },
        pendingCast: event.player === state.myColor ? null : state.pendingCast,
        lastCast: { player: event.player, spellId: event.spellId, targets: event.targets, effects: event.effects, seq },
        spellLog: [
          ...state.spellLog,
          { player: event.player, spellId: event.spellId, targets: event.targets, moveIndex: game?.moves.length ?? 0, seq },
        ],
      };
    }

    case 'effect_expired':
      return game === null
        ? base
        : { ...base, game: { ...game, activeEffects: removeEffect(game.activeEffects, event.expired.square, event.expired.kind) } };

    case 'square_effects_changed':
      return game === null ? base : { ...base, game: { ...game, squareStates: event.squareStates } };

    case 'rune_triggered':
      // Lo stato (FEN, gelo, cimitero, runa consumata) è già arrivato o arriva con gli eventi vicini: qui solo l'avviso.
      return { ...base, lastRune: { square: event.square, owner: event.owner, onEnter: event.onEnter, result: event.result, seq } };

    case 'graveyard_changed':
      return game === null ? base : { ...base, game: { ...game, graveyards: { ...game.graveyards, [event.player]: event.graveyard } } };

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
      // Rifiuto del server: la mossa mostrata in anticipo torna indietro e la carta torna giocabile.
      return { ...base, lastError: { info: event.error, seq }, optimistic: null, pendingCast: null };

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
  /** Mostra subito la propria mossa, in attesa della conferma del server. */
  previewMove(from: Square, to: Square): void;
  /** Segna il cast come partito: nessun effetto sullo stato di gioco, solo attesa della risposta. */
  beginCast(spellId: SpellId): void;
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
    previewMove(from, to) {
      set({ optimistic: { from, to, at: now() } });
    },
    beginCast(spellId) {
      set({ pendingCast: { spellId, at: now() } });
    },
    enterQueue() {
      set({ ...initialMatchState(get().selfId), lifecycle: 'queued' });
    },
    reset(nextSelfId) {
      set(initialMatchState(nextSelfId));
    },
  }));
}
