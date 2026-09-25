import { useTranslation } from 'react-i18next';

import type { Color } from '../model';
import { PieceIcon } from '../pieces/PieceIcon';
import { PROMOTION_CHOICES } from '../position';
import { useBoardTheme } from './boardTheme';

/**
 * Scelta del pezzo di promozione: quattro opzioni, annullabile (briefing §7.5). Non è nelle tavole (D20): pannello
 * Pietra col titolo in Cinzel, i pezzi su case chiare del tema scelto, anello oro al passaggio e al focus.
 */
export function PromotionDialog({ color, onChoose, onCancel }: { color: Color; onChoose(letter: string): void; onCancel(): void }) {
  const { t } = useTranslation();
  const theme = useBoardTheme();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('match.promotion.title')}
      className="absolute inset-0 z-10 flex items-center justify-center bg-app/80"
      onClick={onCancel}
    >
      <div
        data-board-theme={theme}
        className="flex flex-col items-center gap-3 rounded-16 bg-panel p-4 shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-display text-18 font-bold tracking-[0.02em]">{t('match.promotion.title')}</h2>
        <div className="flex gap-2">
          {PROMOTION_CHOICES.map((choice) => (
            <button
              key={choice.letter}
              type="button"
              aria-label={t(`board.piece.${choice.kind}`)}
              className="size-16 rounded-8 bg-board-light p-0 hover:shadow-ring-gold focus-visible:shadow-ring-gold focus-visible:outline-none"
              onClick={() => onChoose(choice.letter)}
            >
              <PieceIcon kind={choice.kind} color={color} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
