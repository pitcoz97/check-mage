import { useTranslation } from 'react-i18next';

import { Button } from '../../design/components/Button';
import { Panel } from '../../design/components/Panel';
import { Board } from '../../game/board/Board';
import { BOARD_THEMES, boardThemeStore, useBoardTheme } from '../../game/board/boardTheme';
import { MiniBoard } from '../../game/board/MiniBoard';
import type { BoardContext } from '../../game/board/selection';
import type { Square, SquareEffects } from '../../game/model';

/**
 * Pagina di sviluppo (`/dev/board`): la scacchiera in tutti i suoi stati, per confrontarla con il componente
 * Scacchiera del design senza avviare una partita. Non esiste nella build di produzione.
 */

/** La posizione del componente Scacchiera del design, con i suoi stati. */
const DESIGN_FEN = 'r2q1rk1/pp2bppp/2np1n2/2p1p3/2B1P3/2NP1N1P/PPP2PP1/R1BQ1RK1 w - - 0 1';
const DESIGN_EFFECTS: readonly SquareEffects[] = [
  { square: 'c3', effects: [{ kind: 'freeze', remainingTurns: 1, sourceSpellId: null }] },
  { square: 'e4', effects: [{ kind: 'shield', remainingTurns: 2, sourceSpellId: null }] },
];
/** I bersagli della tavola "Direzione visiva". */
const DESIGN_TARGETS = new Set<Square>(['f6', 'e7', 'c6', 'd8', 'd6']);

/** Il re bianco sotto scacco: toccandolo si vedono le mosse legali, cattura compresa. */
const CHECK_FEN = '4k3/8/8/8/8/5n2/4q3/R3K2R w - - 0 1';

function context(fen: string, canAct: boolean): BoardContext {
  return { fen, myColor: 'white', activePlayer: 'white', phase: 'move', frozen: new Set<Square>(), squareStates: [], canAct };
}

const ignore = () => undefined;

export function BoardGallery() {
  const { t } = useTranslation();
  const theme = useBoardTheme();

  return (
    <div className="safe-area mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-28 font-bold">{t('board.dev.title')}</h1>
      <Panel role="group" aria-label={t('board.theme.label')} className="flex flex-wrap items-center gap-2 p-3">
        {BOARD_THEMES.map((option) => (
          <Button key={option} variant={option === theme ? 'primary' : 'secondary'} onClick={() => void boardThemeStore.getState().set(option)}>
            {t(`board.theme.${option}`)}
          </Button>
        ))}
      </Panel>

      <div className="flex flex-wrap items-start gap-6">
        <section className="flex w-full max-w-[560px] flex-col gap-2">
          <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('board.dev.states')}</h2>
          <Board
            context={context(DESIGN_FEN, false)}
            orientation="white"
            lastMove={{ from: 'c7', to: 'c5' }}
            optimistic={null}
            effects={DESIGN_EFFECTS}
            targeting={{ squares: DESIGN_TARGETS, onPick: ignore, onCancel: ignore }}
            onMove={ignore}
            onRefused={ignore}
          />
        </section>

        <section className="flex w-full max-w-[560px] flex-col gap-2">
          <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('board.dev.moves')}</h2>
          <Board
            context={context(CHECK_FEN, true)}
            orientation="white"
            lastMove={{ from: 'd3', to: 'e2' }}
            optimistic={null}
            onMove={ignore}
            onRefused={ignore}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-12 font-extrabold tracking-label text-muted uppercase">{t('board.dev.mini')}</h2>
          <MiniBoard fen={DESIGN_FEN} orientation="white" lastMove={{ from: 'c7', to: 'c5' }} label={t('board.dev.miniLabel')} className="w-[240px]" />
        </section>
      </div>
    </div>
  );
}
