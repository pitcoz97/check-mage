import type { TFunction } from 'i18next';

import { PIECE_KINDS, type PieceKind } from '../game/model';
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
   * Pezzi fra cui il giocatore deve scegliere (`cast_spell.choice`), o `null` se l'effetto non chiede nulla o
   * resta una sola opzione (il server la deduce).
   */
  choiceOptions?(params: Record<string, unknown>, ctx: ChoiceContext): readonly PieceKind[] | null;
  /** L'effetto toglie il pezzo bersaglio: un pezzo nemico su un santuario non si evidenzia (ASSUMPTIONS M26). */
  readonly removesPiece?: boolean;
}

/** Quello che serve per calcolare le opzioni di una scelta: il proprio cimitero. */
export interface ChoiceContext {
  readonly graveyard: readonly PieceKind[];
}

function pieceList(params: Record<string, unknown>, key: string): PieceKind[] {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is PieceKind => typeof x === 'string' && (PIECE_KINDS as readonly string[]).includes(x));
}

/** Nomi dei pezzi elencati nei params, localizzati e uniti ("cavallo, alfiere o torre"). */
function pieceNames(t: TFunction, params: Record<string, unknown>, key: string): string {
  const names = pieceList(params, key).map((kind) => t(`board.piece.${kind}`));
  if (names.length <= 1) return names.join('');
  return t('spells.effect.orList', { head: names.slice(0, -1).join(', '), last: names.at(-1) ?? '' });
}

function intParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** I `kind` degli effetti del server (`spells/spells.go`, porting in `mock-server/game/room.ts`). */
export const EFFECT_KINDS = [
  'destroy_piece',
  'freeze_piece',
  'shield_piece',
  'draw_card',
  'gain_mana',
  'move_piece',
  'summon_pawn',
  'freeze_all',
  'shield_area',
  'swap_pieces',
  'transform_piece',
  'promote_piece',
  'revive_piece',
  'restore_castling_rights',
  'create_wall',
  'create_square_effect',
] as const;
export type KnownEffectKind = (typeof EFFECT_KINDS)[number];

const UNKNOWN_EFFECT: EffectPresentation = {
  icon: 'question',
  art: ART.quiet,
  label: (t) => t('spells.effect.unknown.label'),
  describe: (t) => t('spells.effect.unknown.text'),
};

const EFFECTS: Record<KnownEffectKind, EffectPresentation> = {
  destroy_piece: {
    icon: 'burst',
    art: ART.doom,
    label: (t) => t('spells.effect.destroy_piece.label'),
    describe: (t) => t('spells.effect.destroy_piece.text'),
    removesPiece: true,
  },
  freeze_piece: {
    icon: 'frost',
    art: ART.frost,
    label: (t) => t('spells.effect.freeze_piece.label'),
    describe: (t, params) => {
      const count = intParam(params, 'duration', 1);
      return t(count === 1 ? 'spells.effect.freeze_piece.textOne' : 'spells.effect.freeze_piece.textMany', { count });
    },
  },
  shield_piece: {
    icon: 'shield',
    art: ART.gold,
    label: (t) => t('spells.effect.shield_piece.label'),
    describe: (t, params) => {
      const count = intParam(params, 'duration', 1);
      return t(count === 1 ? 'spells.effect.shield_piece.textOne' : 'spells.effect.shield_piece.textMany', { count });
    },
  },
  draw_card: {
    icon: 'card',
    art: ART.arcane,
    label: (t) => t('spells.effect.draw_card.label'),
    describe: (t, params) => {
      const count = intParam(params, 'amount', 1);
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
    // Con `relative` il server calcola l'arrivo: il pezzo avanza di `squares` case (`game/room.go`, moveEndpoints).
    describe: (t, params) => {
      if (params['relative'] !== 'forward') return t('spells.effect.move_piece.text');
      const count = intParam(params, 'squares', 1);
      return t(count === 1 ? 'spells.effect.move_piece.forwardOne' : 'spells.effect.move_piece.forwardMany', { count });
    },
  },
  summon_pawn: {
    icon: 'spark',
    art: ART.gold,
    label: (t) => t('spells.effect.summon_pawn.label'),
    describe: (t, params) => t('spells.effect.summon_pawn.text', { max: intParam(params, 'max_pawns', 8) }),
  },
  // Icone provvisorie: gli effetti dello Step 2 riusano quelle esistenti finché il design non ne disegna di proprie.
  freeze_all: {
    icon: 'frost',
    art: ART.frost,
    label: (t) => t('spells.effect.freeze_all.label'),
    describe: (t, params) => t('spells.effect.freeze_all.text', { pieces: pieceNames(t, params, 'pieces') }),
  },
  shield_area: {
    icon: 'shield',
    art: ART.gold,
    label: (t) => t('spells.effect.shield_area.label'),
    describe: (t, params) =>
      t(params['around'] === 'own_king' ? 'spells.effect.shield_area.aroundKing' : 'spells.effect.shield_area.pawnsSideBySide'),
  },
  swap_pieces: {
    icon: 'arrow',
    art: ART.leap,
    label: (t) => t('spells.effect.swap_pieces.label'),
    describe: (t) => t('spells.effect.swap_pieces.text'),
  },
  transform_piece: {
    icon: 'spark',
    art: ART.arcane,
    label: (t) => t('spells.effect.transform_piece.label'),
    describe: (t) => t('spells.effect.transform_piece.text'),
  },
  promote_piece: {
    icon: 'crystal',
    art: ART.gold,
    label: (t) => t('spells.effect.promote_piece.label'),
    describe: (t, params) => t('spells.effect.promote_piece.text', { pieces: pieceNames(t, params, 'choices') }),
    choiceOptions: (params) => {
      const options = pieceList(params, 'choices');
      return options.length > 1 ? options : null;
    },
  },
  revive_piece: {
    icon: 'spark',
    art: ART.doom,
    label: (t) => t('spells.effect.revive_piece.label'),
    describe: (t, params) => t('spells.effect.revive_piece.text', { pieces: pieceNames(t, params, 'pieces') }),
    // Solo i tipi davvero presenti nel proprio cimitero; con uno solo il server lo deduce.
    choiceOptions: (params, ctx) => {
      const options = pieceList(params, 'pieces').filter((kind) => ctx.graveyard.includes(kind));
      return options.length > 1 ? options : null;
    },
  },
  restore_castling_rights: {
    icon: 'arrow',
    art: ART.gold,
    label: (t) => t('spells.effect.restore_castling_rights.label'),
    describe: (t) => t('spells.effect.restore_castling_rights.text'),
  },
  // Icone provvisorie anche per gli stati delle case (Step 3), come per gli effetti dello Step 2.
  create_wall: {
    icon: 'frost',
    art: ART.frost,
    label: (t) => t('spells.effect.create_wall.label'),
    describe: (t, params) => {
      const count = intParam(params, 'duration', 1);
      return t(count === 1 ? 'spells.effect.create_wall.textOne' : 'spells.effect.create_wall.textMany', { count });
    },
  },
  create_square_effect: {
    icon: 'shield',
    art: ART.gold,
    label: (t) => t('spells.effect.create_square_effect.label'),
    describe: (t, params) => {
      if (params['effect'] !== 'no_capture') return t('spells.effect.create_square_effect.text');
      const count = intParam(params, 'duration', 1);
      return t(count === 1 ? 'spells.effect.create_square_effect.noCaptureOne' : 'spells.effect.create_square_effect.noCaptureMany', {
        count,
      });
    },
  },
};

/** Pezzi fra cui scegliere per questa magia, o `null` se non c'è nulla da scegliere. */
export function spellChoiceOptions(effects: readonly SpellEffect[], ctx: ChoiceContext): readonly PieceKind[] | null {
  for (const effect of effects) {
    const options = effectPresentation(effect.kind).choiceOptions?.(effect.params, ctx) ?? null;
    if (options !== null) return options;
  }
  return null;
}

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

// ---------------------------------------------------------------------------------------------------
// Stati persistenti sul pezzo (`effects/tracker.go:9-13`) e sulla casa (`effects/squares.go`): quello che velo e
// badge disegnano sulla casella
// ---------------------------------------------------------------------------------------------------

export interface StatePresentation {
  /** Icona del badge in alto a destra della casa e sua classe di colore. */
  readonly badge: StateIconName;
  readonly badgeClass: string;
  /** Resa sulla casa (velo, anello): classi intere, perché Tailwind le legge dal sorgente. */
  readonly veil: string;
  label(t: TFunction): string;
}

export const PIECE_STATE_KINDS = ['freeze', 'shield', 'wall', 'no_capture'] as const;
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
  // Stati delle case, non disegnati dal design (D20): blocco di ghiaccio e alone dorato, dalla sua palette.
  wall: {
    badge: 'wall',
    badgeClass: 'text-state-frost-ink',
    veil: 'inset-[7%] rounded-4 bg-board-wall shadow-ring-wall',
    label: (t) => t('spells.state.wall'),
  },
  no_capture: {
    badge: 'sanctuary',
    badgeClass: 'text-gold',
    veil: 'inset-0 bg-[radial-gradient(circle,var(--board-sanctuary)_0%,transparent_72%)] shadow-ring-sanctuary',
    label: (t) => t('spells.state.no_capture'),
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
