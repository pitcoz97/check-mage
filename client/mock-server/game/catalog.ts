import rawCatalog from '../spells.json';
import type { WirePhase } from '../wire';

/**
 * Porting di `spells/spells.go` e `spells/catalog.go`. Il catalogo arriva da `spells.json`, identico all'output di
 * `GET /spells` e a `src/spells/fallback.json`.
 */

/** `spells/spells.go:27-32`. */
export type TargetType = 'square' | 'own_piece' | 'enemy_piece';

export type PieceKind = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

/** `TargetSpec` (`spells/spells.go:47-64`): i campi opzionali mancano quando sono vuoti (omitempty). */
export interface TargetSpec {
  type: TargetType;
  pieces?: PieceKind[];
  require_effect?: string;
  empty_square?: boolean;
  max_distance?: number;
  own_ranks?: number[];
  min_rank?: number;
}

export type Rarity = 'common' | 'legendary';

export interface SpellEffect {
  kind: string;
  params?: Record<string, unknown>;
}

export interface Spell {
  id: string;
  name: string;
  mana_cost: number;
  phases: WirePhase[];
  targets: TargetSpec[];
  effects: SpellEffect[];
  tags: string[];
  rarity: Rarity;
  limits?: Record<string, number>;
}

// `spells/spells.go:17-22`
export const STARTING_HAND = 4;
export const DECK_SIZE = 40;
export const INITIAL_MANA = 1;
export const MAX_MANA_CAP = 10;

/** `spells/spells.go:84-86`. */
export const LIMIT_PER_TURN = 'per_turn';

const TARGET_TYPES: readonly string[] = ['square', 'own_piece', 'enemy_piece'];
const PIECE_KINDS: readonly string[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const PHASES: readonly string[] = ['draw', 'main1', 'move', 'main2', 'end_turn'];

function validTarget(spec: unknown): boolean {
  if (typeof spec !== 'object' || spec === null) return false;
  const t = spec as Partial<TargetSpec>;
  return (
    typeof t.type === 'string' &&
    TARGET_TYPES.includes(t.type) &&
    (t.pieces === undefined || (Array.isArray(t.pieces) && t.pieces.every((p) => PIECE_KINDS.includes(p))))
  );
}

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
      Array.isArray(spell.targets) &&
      spell.targets.every(validTarget) &&
      Array.isArray(spell.effects) &&
      Array.isArray(spell.tags) &&
      (spell.rarity === 'common' || spell.rarity === 'legendary');
    if (!ok) throw new Error(`spells.json: voce ${index} non valida`);
    map.set(spell.id as string, spell as Spell);
  });
  return map;
}

export const CATALOG: ReadonlyMap<string, Spell> = loadCatalog(rawCatalog);
/** Il catalogo come lo serializza `GET /spells` (stessi oggetti di `spells.json`). */
export const RAW_CATALOG: readonly Spell[] = [...CATALOG.values()];

/** `spells/catalog.go` (`deckRecipe`): 40 carte. */
export const DECK_RECIPE: readonly (readonly [string, number])[] = [
  ['frost', 3],
  ['ice_chain', 2],
  ['shatter', 3],
  ['eternal_winter', 1],
  ['blood_pact', 3],
  ['recall', 3],
  ['resurrection', 1],
  ['blink', 2],
  ['swap', 2],
  ['metamorphosis', 2],
  ['shield', 3],
  ['royal_shield', 2],
  ['royal_guard', 2],
  ['divine_castling', 2],
  ['forced_march', 3],
  ['conscription', 3],
  ['phalanx', 2],
  ['early_promotion', 1],
];

export function buildDeck(): string[] {
  return DECK_RECIPE.flatMap(([id, n]) => Array.from({ length: n }, () => id));
}

export function paramInt(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = params?.[key];
  return typeof value === 'number' ? Math.trunc(value) : fallback;
}

/** `paramStrings` (`game/room.go`): lista di stringhe, vuota se assente. */
export function paramStrings(params: Record<string, unknown> | undefined, key: string): string[] {
  const value = params?.[key];
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

/** `paramStringMap` (`game/room.go`): mappa stringa → stringa, vuota se assente. */
export function paramStringMap(params: Record<string, unknown> | undefined, key: string): Record<string, string> {
  const value = params?.[key];
  const out: Record<string, string> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** `paramBool` (`game/room.go`): `false` se assente o di altro tipo. */
export function paramBool(params: Record<string, unknown> | undefined, key: string): boolean {
  return params?.[key] === true;
}
