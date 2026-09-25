import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { Color, PieceKind } from '../model';
import { PieceIcon } from '../pieces/PieceIcon';
import { PROMOTION_CHOICES } from '../position';
import { useBoardTheme } from './boardTheme';

/**
 * Scelta di un pezzo sopra la scacchiera: pannello Pietra col titolo in Cinzel, i pezzi su case chiare del tema
 * scelto, anello oro al passaggio e al focus (D20). Annullabile col tocco fuori e con Esc (briefing §7.5).
 */
export function PieceChoiceDialog({
  color,
  title,
  options,
  onChoose,
  onCancel,
}: {
  color: Color;
  title: string;
  options: readonly PieceKind[];
  onChoose(kind: PieceKind): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const theme = useBoardTheme();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-piece-choice
      className="absolute inset-0 z-10 flex items-center justify-center bg-app/80"
      onClick={onCancel}
    >
      <div
        data-board-theme={theme}
        className="flex flex-col items-center gap-3 rounded-16 bg-panel p-4 shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-display text-18 font-bold tracking-[0.02em]">{title}</h2>
        <div className="flex gap-2">
          {options.map((kind) => (
            <button
              key={kind}
              type="button"
              data-choice={kind}
              aria-label={t(`board.piece.${kind}`)}
              className="size-16 rounded-8 bg-board-light p-0 hover:shadow-ring-gold focus-visible:shadow-ring-gold focus-visible:outline-none"
              onClick={() => onChoose(kind)}
            >
              <PieceIcon kind={kind} color={color} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Promozione di una mossa: le quattro scelte degli scacchi, con la lettera UCI. */
export function PromotionDialog({ color, onChoose, onCancel }: { color: Color; onChoose(letter: string): void; onCancel(): void }) {
  const { t } = useTranslation();
  return (
    <PieceChoiceDialog
      color={color}
      title={t('match.promotion.title')}
      options={PROMOTION_CHOICES.map((choice) => choice.kind)}
      onCancel={onCancel}
      onChoose={(kind) => {
        const letter = PROMOTION_CHOICES.find((choice) => choice.kind === kind)?.letter;
        if (letter !== undefined) onChoose(letter);
      }}
    />
  );
}
