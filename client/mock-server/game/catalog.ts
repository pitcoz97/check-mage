import rawCatalog from '../spells.json';
import type { WirePhase } from '../wire';

/** Porting di `spells/spells.go`. Il catalogo arriva da `spells.json`, identico a `src/spells/fallback.json`. */

export type TargetType = 'none' | 'square' | 'piece' | 'own_piece' | 'enemy_piece' | 'piece_move';

export interface SpellEffect {
  kind: string;
  params?: Record<string, unknown>;
}

export interface Spell {
  id: string;
  name: string;
  mana_cost: number;
  phases: WirePhase[];
  target_type: TargetType;
  effects: SpellEffect[];
}

// `spells/spells.go:18-21`
export const STARTING_HAND = 4;
export const DECK_SIZE = 40;
export const INITIAL_MANA = 1;
export const MAX_MANA_CAP = 10;

const TARGET_TYPES: readonly string[] = ['none', 'square', 'piece', 'own_piece', 'enemy_piece', 'piece_move'];
const PHASES: readonly string[] = ['draw', 'main1', 'move', 'main2', 'end_turn'];

/** Il mock verifica il proprio file all'avvio, così un errore di editing emerge subito. */
function loadCatalog(raw: unknown): Map<string, Spell> {
  if (!Array.isArray(raw)) throw new Error('spells.json: atteso un array');
  const map = new Map<string, Spell>();
  raw.forEach((entry: unknown, index) => {
    const spell = entry as Partial<Spell>;
    const ok =
      typeof spell.id === 'string' &&
      typeof spell.name === 'string' &&
      typeof spell.mana_cost === 'number' &&
      Array.isArray(spell.phases) &&
      spell.phases.every((p) => PHASES.includes(p)) &&
      typeof spell.target_type === 'string' &&
      TARGET_TYPES.includes(spell.target_type) &&
      Array.isArray(spell.effects);
    if (!ok) throw new Error(`spells.json: voce ${index} non valida`);
    map.set(spell.id as string, spell as Spell);
  });
  return map;
}

export const CATALOG: ReadonlyMap<string, Spell> = loadCatalog(rawCatalog);
export const RAW_CATALOG: unknown = rawCatalog;

/** `spells/spells.go:37-46`. */
export function targetCount(t: TargetType): number {
  if (t === 'none') return 0;
  if (t === 'piece_move') return 2;
  return 1;
}

/** `spells/spells.go:101-116`: 40 carte. */
export const DECK_RECIPE: readonly (readonly [string, number])[] = [
  ['spark', 8],
  ['jolt', 6],
  ['pulse', 5],
  ['surge', 4],
  ['insight', 4],
  ['channel', 3],
  ['frostbolt', 3],
  ['aegis', 3],
  ['disintegrate', 2],
  ['teleport', 1],
  ['nova', 1],
];

export function buildDeck(): string[] {
  return DECK_RECIPE.flatMap(([id, n]) => Array.from({ length: n }, () => id));
}

export function paramInt(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = params?.[key];
  return typeof value === 'number' ? Math.trunc(value) : fallback;
}
