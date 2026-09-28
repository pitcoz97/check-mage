import type { Sigil } from './deckEditor';

/** Il sigillo del mazzo: le coppie fondo/anello della tavola (D8). */
const SIGIL: Record<Sigil, string> = {
  frost: 'bg-art-frost ring-sigil-frost',
  gold: 'bg-art-gold ring-gold',
  doom: 'bg-art-doom ring-rarity-mythic',
  arcane: 'bg-arcane-deep ring-arcane',
};

const SIZE = { sm: 'size-[30px] rounded-6', md: 'size-[34px] rounded-7', lg: 'size-10 rounded-9', xl: 'size-11 rounded-9' } as const;

export function DeckSigil({ sigil, size }: { sigil: Sigil; size: keyof typeof SIZE }) {
  return <span aria-hidden="true" data-sigil={sigil} className={`shrink-0 ring-[1.5px] ring-inset ${SIGIL[sigil]} ${SIZE[size]}`} />;
}
