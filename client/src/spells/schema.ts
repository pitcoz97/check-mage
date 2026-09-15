import { z } from 'zod';

/**
 * Schema runtime del catalogo magie nella sua forma **interna**.
 * La forma sul filo (snake_case) viene tradotta in `src/api/adapter.ts` e poi validata qui.
 * I tipi derivano dallo schema, non viceversa (briefing §5.1.2).
 */

export const KNOWN_TARGET_TYPES = ['none', 'square', 'piece', 'own_piece', 'enemy_piece'] as const;
export type KnownTargetType = (typeof KNOWN_TARGET_TYPES)[number];

// `kind` e `targetType` sono stringhe aperte: un valore sconosciuto non deve rompere il catalogo (§5.1.6).
export const spellEffectSchema = z.object({
  kind: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
});

export const spellSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  manaCost: z.number().int().min(0),
  phases: z.array(z.string().min(1)),
  targetType: z.string().min(1),
  effects: z.array(spellEffectSchema),
});

export type SpellEffect = z.infer<typeof spellEffectSchema>;
export type Spell = z.infer<typeof spellSchema>;

export function isKnownTargetType(value: string): value is KnownTargetType {
  return (KNOWN_TARGET_TYPES as readonly string[]).includes(value);
}
