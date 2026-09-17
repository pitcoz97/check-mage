import { useTranslation } from 'react-i18next';

import { Panel } from '../../design/components/Panel';
import { MatchLayout } from './MatchLayout';

const FILES = 8;

/** Scacchiera segnaposto: griglia statica con i colori dei token, senza pezzi né logica (sostituita allo Step 4). */
function BoardPlaceholder() {
  const { t } = useTranslation();
  const squares = Array.from({ length: FILES * FILES }, (_, i) => {
    const light = (Math.floor(i / FILES) + (i % FILES)) % 2 === 0;
    return <div key={i} className={light ? 'bg-board-light' : 'bg-board-dark'} />;
  });
  return (
    <div role="img" aria-label={t('match.board')} className="grid h-full w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-sm">
      {squares}
    </div>
  );
}

function Region({ title }: { title: string }) {
  return (
    <Panel className="flex min-h-[var(--hit-target)] items-center px-3 py-2">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
    </Panel>
  );
}

/** Schermata di partita: per ora solo le regioni del layout, riempite agli Step 4–5. */
export function Match() {
  const { t } = useTranslation();
  return (
    <MatchLayout
      opponent={<Region title={t('match.opponent')} />}
      board={<BoardPlaceholder />}
      phases={<Region title={t('match.phases')} />}
      history={<Region title={t('match.history')} />}
      actions={<Region title={t('match.actions')} />}
      self={<Region title={t('match.you')} />}
      hand={<Region title={t('match.hand')} />}
    />
  );
}
