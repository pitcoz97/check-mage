import { useTranslation } from 'react-i18next';

import { PHASES } from '../../game/model';
import { Panel } from '../../design/components/Panel';
import { useMatch } from '../../store/MatchProvider';

/** Fasi del turno (`phase/phase.go`): `end_turn` è una transizione automatica e non si mostra. */
const VISIBLE_PHASES = PHASES.filter((phase) => phase !== 'end_turn');

export function PhaseTrack() {
  const { t } = useTranslation();
  const phase = useMatch((s) => s.game?.phase ?? null);
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const myColor = useMatch((s) => s.myColor);
  const mine = myColor !== null && activePlayer === myColor;

  return (
    <Panel className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
      <h2 className="sr-only">{t('match.phases')}</h2>
      <ol className="flex flex-wrap items-center gap-x-2 text-14">
        {VISIBLE_PHASES.map((step) => (
          <li
            key={step}
            data-phase={step}
            data-current={phase === step}
            className={phase === step ? 'font-semibold text-accent' : 'text-muted'}
          >
            {t(`match.phase.${step}`)}
          </li>
        ))}
      </ol>
      <span className={`ml-auto text-14 ${mine ? 'font-semibold text-accent' : 'text-muted'}`}>
        {t(mine ? 'match.turn.yours' : 'match.turn.opponent')}
      </span>
    </Panel>
  );
}
