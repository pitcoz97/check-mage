import { z } from 'zod';

/**
 * Schema runtime del catalogo magie nella sua forma **interna**.
 * La forma sul filo (snake_case) viene tradotta in `src/api/adapter.ts` e poi validata qui.
 * I tipi derivano dallo schema, non viceversa (briefing §5.1.2).
 */

// Stessi valori di chess-server `internal/spells/spells.go` (`TargetType`).
export const KNOWN_TARGET_TYPES = ['square', 'own_piece', 'enemy_piece'] as const;
export type KnownTargetType = (typeof KNOWN_TARGET_TYPES)[number];

export const RARITIES = ['common', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

// `kind`, `type` dei bersagli e tag sono stringhe aperte: un valore sconosciuto non deve rompere il catalogo (§5.1.6).
export const spellEffectSchema = z.object({
  kind: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
});

/** Un bersaglio della magia (`TargetSpec`, `spells/spells.go`): tipo e filtri, con i campi assenti già risolti. */
export const targetSpecSchema = z.object({
  type: z.string().min(1),
  /** Pezzi ammessi; vuoto = tutti tranne il re. */
  pieces: z.array(z.string()),
  /** Stato che il pezzo deve avere (es. `freeze`), o `null`. */
  requireEffect: z.string().nullable(),
  emptySquare: z.boolean(),
  /** Distanza massima (Chebyshev) dal bersaglio precedente; 0 = nessun limite. */
  maxDistance: z.number().int().min(0),
  /** Traverse ammesse, relative a chi lancia (1 = la sua prima); vuoto = tutte. */
  ownRanks: z.array(z.number().int()),
  /** Traversa minima relativa a chi lancia; 0 = nessun limite. */
  minRank: z.number().int().min(0),
});

export const spellSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  manaCost: z.number().int().min(0),
  phases: z.array(z.string().min(1)),
  /** Bersagli in ordine; vuoto = nessun bersaglio. */
  targets: z.array(targetSpecSchema),
  effects: z.array(spellEffectSchema),
  /** Archetipi (gelo, necro, arcano, sacro, rune, falange). */
  tags: z.array(z.string()),
  rarity: z.enum(RARITIES),
  /** Cast massimi per turno, o `null` se la magia non ha limiti. */
  perTurn: z.number().int().min(1).nullable(),
});

export type SpellEffect = z.infer<typeof spellEffectSchema>;
export type TargetSpec = z.infer<typeof targetSpecSchema>;
export type Spell = z.infer<typeof spellSchema>;

export function isKnownTargetType(value: string): value is KnownTargetType {
  return (KNOWN_TARGET_TYPES as readonly string[]).includes(value);
}
