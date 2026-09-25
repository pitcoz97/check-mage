import { useTranslation } from 'react-i18next';

import { piecesOf } from '../../game/fen';
import type { Phase } from '../../game/model';
import { useMatch } from '../../store/MatchProvider';
import type { Casting } from './useCasting';
import type { Notice } from './useNotice';

/**
 * Il box del suggerimento (tavole della partita, D16): l'unico posto per i messaggi della partita. In ordine di
 * priorità: un avviso recente, un'offerta di patta da accettare o rifiutare, la carta che si sta lanciando, altrimenti cosa si può fare nella fase corrente (con i
 * propri pezzi congelati). Su desktop è il riquadro nel pannello del turno, su Android la riga sotto le fasi.
 */

interface HintContent {
  readonly mode: 'notice' | 'casting' | 'idle';
  readonly title: string;
  readonly text: string;
  /** Riga compatta di Android. */
  readonly line: string;
}

function useHintContent(casting: Casting, notice: Notice | null): HintContent {
  const { t } = useTranslation();
  const phase = useMatch((s) => s.game?.phase ?? 'unknown');
  const fen = useMatch((s) => s.game?.fen ?? '');
  const effects = useMatch((s) => s.game?.activeEffects ?? []);
  const myColor = useMatch((s) => s.myColor);
  const activePlayer = useMatch((s) => s.game?.activePlayer ?? null);
  const drawOffered = useMatch((s) => s.drawOffer.incoming);

  if (notice !== null) {
    return { mode: 'notice', title: t(`match.hint.notice.${notice.kind}`), text: notice.text, line: notice.text };
  }

  // Un'offerta di patta aspetta una risposta: su Android i pulsanti stanno nel foglio del Menu, quindi lo si dice qui.
  if (drawOffered) {
    const text = t('match.action.drawIncoming');
    return { mode: 'notice', title: t('match.hint.notice.draw'), text: `${text}. ${t('match.hint.drawBelow')}`, line: `${text} · ${t('match.hint.drawInMenu')}` };
  }

  if (casting.spellName !== null) {
    const title = t('match.hint.casting', { name: casting.spellName, cost: casting.spellCost ?? t('spells.costUnknown') });
    const text = [casting.prompt, t('spells.targeting.cancelHint')].filter((part) => part !== null).join(' ');
    return { mode: 'casting', title, text, line: `${casting.spellName} · ${casting.prompt ?? ''}` };
  }

  const phaseLabel = t(`match.phase.${phase}`);
  if (myColor === null || activePlayer !== myColor) {
    return {
      mode: 'idle',
      title: t('match.turn.opponent'),
      text: t('match.hint.opponentText'),
      line: `${phaseLabel} · ${t('match.hint.short.opponent')}`,
    };
  }

  // I propri pezzi congelati: la frase della tavola ("Il tuo Cc3 è congelato"), con la casella in chiaro (UCI, D18).
  const pieceOn = new Map(piecesOf(fen).map((piece) => [piece.square, piece]));
  const frozen = effects.flatMap((entry) => {
    const piece = pieceOn.get(entry.square);
    const freeze = entry.effects.find((effect) => effect.kind === 'freeze');
    if (piece === undefined || piece.color !== myColor || freeze === undefined) return [];
    const args = { piece: t(`board.piece.${piece.kind}`), square: entry.square, count: freeze.remainingTurns };
    return [freeze.remainingTurns === 1 ? t('match.hint.frozenOne', args) : t('match.hint.frozenMany', args)];
  });
  const current: Phase | 'unknown' = phase;
  return {
    mode: 'idle',
    title: phaseLabel,
    text: [t(`match.hint.idle.${current}`), ...frozen].join(' '),
    line: `${phaseLabel} · ${t(`match.hint.short.${current}`)}`,
  };
}

/** La scintilla del design: la firma del box. */
function Sparkle({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />
      <path d="M18 16l.7 1.8 1.8.7-1.8.7L18 21l-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

export function HintBox({ casting, notice, variant }: { casting: Casting; notice: Notice | null; variant: 'panel' | 'line' }) {
  const content = useHintContent(casting, notice);

  if (variant === 'line') {
    const tone = content.mode === 'casting' ? 'text-arcane-bright' : content.mode === 'notice' ? 'text-primary' : 'text-muted';
    return (
      <p
        role="status"
        aria-live="polite"
        data-hint-box="line"
        data-mode={content.mode}
        className={`flex min-h-5 items-center justify-center gap-1.5 text-center text-13 font-semibold ${tone}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 shrink-0" fill="currentColor">
          <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />
        </svg>
        {content.line}
      </p>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-hint-box="panel"
      data-mode={content.mode}
      className={`flex items-start gap-3 rounded-10 px-3.5 py-3 ${content.mode === 'casting' ? 'bg-hint-casting shadow-ring-hint-casting' : 'bg-sunken'}`}
    >
      <Sparkle className="mt-px size-5 shrink-0 text-arcane-bright" />
      <div className="flex flex-col gap-[3px]">
        <p className="text-14 font-bold">{content.title}</p>
        <p className="text-13 leading-[1.4] text-tertiary">{content.text}</p>
      </div>
    </div>
  );
}
