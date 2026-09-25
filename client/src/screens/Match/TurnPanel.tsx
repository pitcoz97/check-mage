import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Panel } from '../../design/components/Panel';
import { PHASES, type Phase } from '../../game/model';
import { useMatch } from '../../store/MatchProvider';

/** Fasi del turno (`phase/phase.go`): `end_turn` è una transizione automatica e non si mostra. */
const VISIBLE_PHASES: readonly Phase[] = PHASES.filter((phase) => phase !== 'end_turn');

type PillState = 'done' | 'current' | 'next';

function pillState(step: Phase, phase: Phase | 'unknown'): PillState {
  const current = phase === 'unknown' ? -1 : VISIBLE_PHASES.indexOf(phase);
  const index = VISIBLE_PHASES.indexOf(step);
  if (current < 0) return 'next';
  return index < current ? 'done' : index === current ? 'current' : 'next';
}

const PILL: Record<PillState, string> = {
  done: 'bg-quiet text-muted',
  current: 'bg-arcane-deep text-primary shadow-ring-arcane',
  next: 'bg-sunken text-faint',
};

/**
 * Le quattro pillole delle fasi: passata (con la spunta su desktop), corrente in viola con l'anello, futura spenta.
 * Su Android sono più basse e senza spunta (tavola "Partita · Android").
 */
export function PhasePills({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const phase = useMatch((s) => s.game?.phase ?? 'unknown');
  return (
    <ol aria-label={t('match.phases')} className={`flex grow ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {VISIBLE_PHASES.map((step) => {
        const state = pillState(step, phase);
        return (
          <li
            key={step}
            data-phase={step}
            data-current={state === 'current'}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`flex grow basis-0 items-center justify-center gap-1.5 font-bold whitespace-nowrap ${
              compact ? 'h-8 rounded-7 text-[11.5px]' : 'h-[34px] rounded-8 text-13'
            } ${PILL[state]}`}
          >
            {state === 'done' && !compact && (
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
            {t(`match.phase.${step}`)}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Pannello del turno nella colonna laterale (tavola "Partita · desktop"): "Turno N · Tocca a te", il colore di chi
 * muove, le fasi e il box del suggerimento. `N` è il numero di mossa degli scacchi: il server conta insieme i turni
 * dei due giocatori (`turn_number`, ASSUMPTIONS A13).
 */
export function TurnPanel({ hint }: { hint: ReactNode }) {
  const { t } = useTranslation();
  const turnNumber = useMatch((s) => s.game?.turnNumber ?? 1);
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const myColor = useMatch((s) => s.myColor);
  const mine = myColor !== null && activePlayer === myColor;
  const who = t(mine ? 'match.turn.yours' : 'match.turn.opponentShort');

  return (
    <Panel data-turn className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-20 font-bold tracking-[0.02em]">{t('match.turn.title', { n: Math.max(1, Math.ceil(turnNumber / 2)), who })}</h2>
        {activePlayer !== null && activePlayer !== 'unknown' && (
          <span className="rounded-pill bg-gold px-2.5 py-1 text-12 font-bold text-on-gold">
            {t(activePlayer === 'white' ? 'match.colorWhite' : 'match.colorBlack')}
          </span>
        )}
      </div>
      <PhasePills />
      {hint}
    </Panel>
  );
}
