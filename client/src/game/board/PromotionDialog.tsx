import { useTranslation } from 'react-i18next';

import type { Color } from '../model';
import { PieceIcon } from '../pieces/PieceIcon';
import { PROMOTION_CHOICES } from '../position';

/** Scelta del pezzo di promozione: quattro opzioni, annullabile (briefing §7.5). */
export function PromotionDialog({ color, onChoose, onCancel }: { color: Color; onChoose(letter: string): void; onCancel(): void }) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('match.promotion.title')}
      className="absolute inset-0 z-10 flex items-center justify-center bg-app/80"
      onClick={onCancel}
    >
      <div className="flex gap-2 rounded-md border border-subtle bg-panel p-3" onClick={(event) => event.stopPropagation()}>
        {PROMOTION_CHOICES.map((choice) => (
          <button
            key={choice.letter}
            type="button"
            aria-label={t(`board.piece.${choice.kind}`)}
            className="size-14 rounded-sm bg-elevated p-1 hover:bg-app focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => onChoose(choice.letter)}
          >
            <PieceIcon kind={choice.kind} color={color} />
          </button>
        ))}
      </div>
    </div>
  );
}
