import { crystalStates, type CrystalState } from './manaCap';

/**
 * I dieci rombi del mana (REDESIGN_PLAN.md §3.4, D21): acceso, speso, bloccato. Solo disegno: il numero accanto lo
 * mette chi li usa, perché il colore da solo non basta.
 */

type CrystalSize = 'lg' | 'md' | 'sm';

const SIZE: Record<CrystalSize, string> = {
  lg: 'size-4 rounded-3',
  md: 'size-3 rounded-3',
  sm: 'size-2 rounded-2',
};

const ON: Record<CrystalSize, string> = {
  lg: 'bg-gold shadow-glow-mana',
  md: 'bg-gold shadow-glow-mana',
  sm: 'bg-gold shadow-glow-mana-sm',
};

const OFF: Record<Exclude<CrystalState, 'on'>, string> = {
  spent: 'shadow-ring-mana-spent',
  locked: 'shadow-ring-mana-locked',
};

export function ManaCrystals({ current, max, size, className = '' }: { current: number; max: number; size: CrystalSize; className?: string }) {
  return (
    <span aria-hidden="true" data-mana-crystals className={`flex items-center ${className}`}>
      {crystalStates(current, max).map((state, index) => (
        <span key={index} data-crystal={state} className={`shrink-0 rotate-45 ${SIZE[size]} ${state === 'on' ? ON[size] : OFF[state]}`} />
      ))}
    </span>
  );
}
