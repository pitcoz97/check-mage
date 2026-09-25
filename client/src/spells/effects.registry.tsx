import type { TFunction } from 'i18next';

import type { PlacedPiece } from '../game/position';
import type { EffectIconName } from './icons/EffectIcon';
import { StateIcon, type StateIconName } from './icons/StateIcon';
import type { SpellEffect } from './schema';

/**
 * Registry degli effetti: `kind` → icona, tono, etichetta e testo di regole (briefing §5.1.4).
 *
 * Aggiungere un effetto = aggiungere una voce qui. Nessun componente conosce un `kind` per nome, e nessuno conosce
 * una magia per id. Un `kind` che il client non conosce prende la voce neutra: la carta si vede e resta giocabile.
 *
 * `describe` genera il testo dai parametri del catalogo, quindi un `turns: 2` che diventa `3` riscrive la carta da
 * sé. Le chiavi i18n sono scritte per esteso in ogni voce: così un testo mancante non compila.
 *
 * Due spazi distinti (ASSUMPTIONS A18): qui i **kind di effetto** (`freeze_piece`), che descrivono cosa fa una
 * magia; più sotto i **kind di stato** (`freeze`), che descrivono cosa resta addosso al pezzo.
 */

/**
 * Arte della carta per kind di effetto: fondo e colore dell'icona (componente Carta del design). Classi intere,
 * perché Tailwind le legge dal sorgente; i colori stanno in tokens.css.
 */
export interface EffectArt {
  readonly bg: string;
  readonly ink: string;
}

const ART = {
  leap: { bg: 'bg-art-leap', ink: 'text-art-ink-gold' },
  frost: { bg: 'bg-art-frost', ink: 'text-art-ink-frost' },
  gold: { bg: 'bg-art-gold', ink: 'text-art-ink-gold' },
  arcane: { bg: 'bg-art-arcane', ink: 'text-art-ink-arcane' },
  doom: { bg: 'bg-art-doom', ink: 'text-art-ink-doom' },
  quiet: { bg: 'bg-art-quiet', ink: 'text-art-ink-quiet' },
} as const satisfies Record<string, EffectArt>;

export interface EffectPresentation {
  readonly icon: EffectIconName;
  readonly art: EffectArt;
  label(t: TFunction): string;
  /** Testo di regole dell'effetto, costruito dai `params` del catalogo. */
  describe(t: TFunction, params: Record<string, unknown>): string;
  /**
   * Restringe i bersagli ammessi dal `target_type` della magia, per il **primo** bersaglio. È qui che stanno le
   * regole che dipendono dall'effetto e non dal tipo di bersaglio (il re non si può distruggere).
   */
  allowsTarget?(piece: PlacedPiece | undefined): boolean;
}

function intParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** I `kind` prodotti dal server (`spells/spells.go:51-57`, porting in `mock-server/game/room.ts:307-372`). */
export const EFFECT_KINDS = ['noop', 'destroy_piece', 'freeze_piece', 'shield_piece', 'draw_card', 'gain_mana', 'move_piece'] as const;
export type KnownEffectKind = (typeof EFFECT_KINDS)[number];

const UNKNOWN_EFFECT: EffectPresentation = {
  icon: 'question',
  art: ART.quiet,
  label: (t) => t('spells.effect.unknown.label'),
  describe: (t) => t('spells.effect.unknown.text'),
};

const EFFECTS: Record<KnownEffectKind, EffectPresentation> = {
  noop: {
    icon: 'spark',
    art: ART.quiet,
    label: (t) => t('spells.effect.noop.label'),
    describe: (t) => t('spells.effect.noop.text'),
  },
  destroy_piece: {
    icon: 'burst',
    art: ART.doom,
    label: (t) => t('spells.effect.destroy_piece.label'),
    describe: (t) => t('spells.effect.destroy_piece.text'),
    // `effects.go:181-209` (porting `mock-server/game/fen.ts:107`): il re non si distrugge.
    allowsTarget: (piece) => piece !== undefined && piece.kind !== 'king',
  },
  freeze_piece: {
    icon: 'frost',
    art: ART.frost,
    label: (t) => t('spells.effect.freeze_piece.label'),
    describe: (t, params) => t('spells.effect.freeze_piece.text', { turns: intParam(params, 'turns', 1) }),
  },
  shield_piece: {
    icon: 'shield',
    art: ART.gold,
    label: (t) => t('spells.effect.shield_piece.label'),
    describe: (t, params) => t('spells.effect.shield_piece.text', { turns: intParam(params, 'turns', 1) }),
  },
  draw_card: {
    icon: 'card',
    art: ART.arcane,
    label: (t) => t('spells.effect.draw_card.label'),
    describe: (t, params) => {
      const count = intParam(params, 'count', 1);
      return t(count === 1 ? 'spells.effect.draw_card.textOne' : 'spells.effect.draw_card.textMany', { count });
    },
  },
  gain_mana: {
    icon: 'crystal',
    art: ART.gold,
    label: (t) => t('spells.effect.gain_mana.label'),
    describe: (t, params) => {
      const amount = intParam(params, 'amount', 1);
      return t(amount === 1 ? 'spells.effect.gain_mana.textOne' : 'spells.effect.gain_mana.textMany', { amount });
    },
  },
  move_piece: {
    icon: 'arrow',
    art: ART.leap,
    label: (t) => t('spells.effect.move_piece.label'),
    describe: (t) => t('spells.effect.move_piece.text'),
  },
};

export function isKnownEffectKind(kind: string): kind is KnownEffectKind {
  return (EFFECT_KINDS as readonly string[]).includes(kind);
}

/** Presentazione di un `kind`: quella neutra se il client non lo conosce (mai `undefined`, mai un crash). */
export function effectPresentation(kind: string): EffectPresentation {
  return isKnownEffectKind(kind) ? EFFECTS[kind] : UNKNOWN_EFFECT;
}

/** Testo di regole di una magia: una riga per effetto, nell'ordine del catalogo. */
export function spellRulesText(t: TFunction, effects: readonly SpellEffect[]): string[] {
  return effects.map((effect) => effectPresentation(effect.kind).describe(t, effect.params));
}

/** Filtro dei bersagli imposto dagli effetti della magia (intersezione: tutti devono accettare). */
export function effectsAllowTarget(effects: readonly SpellEffect[], piece: PlacedPiece | undefined): boolean {
  return effects.every((effect) => effectPresentation(effect.kind).allowsTarget?.(piece) ?? true);
}

// ---------------------------------------------------------------------------------------------------
// Stati persistenti sul pezzo (`effects/tracker.go:9-13`): quello che il badge disegna sulla casella
// ---------------------------------------------------------------------------------------------------

export interface StatePresentation {
  /** Icona del badge in alto a destra della casa e sua classe di colore. */
  readonly badge: StateIconName;
  readonly badgeClass: string;
  /** Resa sulla casa (velo, anello): classi intere, perché Tailwind le legge dal sorgente. */
  readonly veil: string;
  label(t: TFunction): string;
}

export const PIECE_STATE_KINDS = ['freeze', 'shield'] as const;
export type KnownStateKind = (typeof PIECE_STATE_KINDS)[number];

const UNKNOWN_STATE: StatePresentation = {
  badge: 'question',
  badgeClass: 'text-muted',
  veil: '',
  label: (t) => t('spells.state.unknown'),
};

/** Resa del componente Scacchiera del design (REDESIGN_PLAN.md §1.2). */
const STATES: Record<KnownStateKind, StatePresentation> = {
  freeze: {
    badge: 'frost',
    badgeClass: 'text-state-frost-ink',
    veil: 'inset-0 bg-board-frozen shadow-ring-frozen',
    label: (t) => t('spells.state.freeze'),
  },
  shield: {
    badge: 'shield',
    badgeClass: 'text-gold',
    veil: 'inset-[3px] rounded-4 shadow-ring-shielded',
    label: (t) => t('spells.state.shield'),
  },
};

export function statePresentation(kind: string): StatePresentation {
  return (PIECE_STATE_KINDS as readonly string[]).includes(kind) ? STATES[kind as KnownStateKind] : UNKNOWN_STATE;
}

/** Badge di uno stato: icona del design colorata dal registry, dimensione decisa da chi lo usa. */
export function StateBadge({ kind, className = '' }: { kind: string; className?: string }) {
  const presentation = statePresentation(kind);
  return <StateIcon name={presentation.badge} className={`${presentation.badgeClass} ${className}`} />;
}
