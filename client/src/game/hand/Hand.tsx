import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cardRefusal, type CardRefusal, type CastContext } from '../../spells/playability';
import type { Spell } from '../../spells/schema';
import type { HandCard } from '../model';
import { spellCardLabel } from './cardLabel';
import { SpellCardFace } from './SpellCard';

/**
 * La propria mano, a ventaglio come nelle tavole della partita (REDESIGN_PLAN.md §3.3, F3). Le carte dell'avversario
 * restano un numero nel suo pannello: qui non esiste nessuna struttura con la sua mano (briefing §2.2).
 *
 * Geometria in `global.css` (`.hand-fan`), su variabili: `--k` è la distanza dal centro. La carta selezionata si
 * alza; toccarla di nuovo annulla (D8). Una carta non giocabile resta toccabile e dice perché (D5).
 *
 * In mano la carta è rimpicciolita come nel design e il suo testo non si legge: la si vede a grandezza piena al
 * passaggio del puntatore, al focus da tastiera e alla pressione prolungata. Non alla selezione: lì parte il
 * targeting, e l'anteprima coprirebbe la scacchiera.
 */

/** Pressione prolungata che apre l'anteprima su touch. */
const LONG_PRESS_MS = 400;

export interface HandProps {
  readonly cards: readonly HandCard[];
  /** Catalogo: `undefined` per uno `spell_id` che il client non conosce. */
  spellOf(spellId: string): Spell | undefined;
  readonly context: CastContext;
  readonly selectedInstanceId: string | null;
  /** Catalogo non ancora caricato: si mostra l'attesa invece di carte tutte sconosciute. */
  readonly loading?: boolean;
  onPick(card: HandCard, spell: Spell): void;
  /** Secondo tocco sulla carta selezionata. */
  onCancel?(): void;
  /** Tocco su una carta che ora non si può giocare. */
  onRefused?(refusal: CardRefusal, spell: Spell | undefined): void;
}

export function Hand({ cards, spellOf, context, selectedInstanceId, loading = false, onPick, onCancel, onRefused }: HandProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dopo una pressione prolungata il click che segue non deve selezionare. */
  const longPressed = useRef(false);

  function clearPress(): void {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  function onPointerDown(event: ReactPointerEvent, instanceId: string): void {
    if (event.pointerType !== 'touch') return;
    longPressed.current = false;
    clearPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setPreview(instanceId);
    }, LONG_PRESS_MS);
  }

  function endPress(): void {
    clearPress();
    if (longPressed.current) setPreview(null);
  }

  if (loading) return <p className="px-2 py-3 text-center text-14 text-muted">{t('spells.handLoading')}</p>;
  if (cards.length === 0) return <p className="px-2 py-3 text-center text-14 text-muted">{t('spells.handEmpty')}</p>;

  const center = (cards.length - 1) / 2;
  // La carta selezionata non si mostra in grande: si sta scegliendo il bersaglio sulla scacchiera.
  const previewed = cards.find((card) => card.instanceId === preview && card.instanceId !== selectedInstanceId);

  return (
    <section data-hand aria-label={t('spells.hand')} className="hand-fan" style={{ '--n': cards.length } as CSSProperties}>
      {previewed !== undefined && (
        <span data-card-preview className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2">
          <SpellCardFace spell={spellOf(previewed.spellId)} spellId={previewed.spellId} />
        </span>
      )}
      {cards.map((card, index) => {
        const spell = spellOf(card.spellId);
        const refusal = cardRefusal(spell, context);
        const selected = card.instanceId === selectedInstanceId;
        const k = index - center;
        return (
          <button
            key={card.instanceId}
            type="button"
            data-card={card.spellId}
            data-playable={refusal === null}
            data-selected={selected}
            aria-disabled={refusal !== null}
            aria-pressed={selected}
            aria-label={spellCardLabel(t, spell, card.spellId, refusal)}
            className="hand-card"
            style={{ '--k': k, '--k2': k * k, '--i': index } as CSSProperties}
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false;
                return;
              }
              if (selected) onCancel?.();
              else if (refusal !== null) onRefused?.(refusal, spell);
              else if (spell !== undefined) onPick(card, spell);
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') setPreview(card.instanceId);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') setPreview(null);
              endPress();
            }}
            onPointerDown={(event) => onPointerDown(event, card.instanceId)}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onContextMenu={(event) => event.preventDefault()}
            onFocus={(event) => {
              if (event.currentTarget.matches(':focus-visible')) setPreview(card.instanceId);
            }}
            onBlur={() => setPreview(null)}
          >
            <span className="hand-card-scale">
              <SpellCardFace spell={spell} spellId={card.spellId} dimmed={refusal !== null} />
            </span>
          </button>
        );
      })}
    </section>
  );
}
