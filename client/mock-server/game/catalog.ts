import rawCatalog from '../spells.json';
import type { WirePhase } from '../wire';

export type TargetType = 'none' | 'square' | 'piece' | 'own_piece' | 'enemy_piece';

export interface MockSpell {
  id: string;
  name: string;
  mana_cost: number;
  phases: WirePhase[];
  target_type: TargetType;
  effects: { kind: string; params: Record<string, unknown> }[];
}

const TARGET_TYPES: readonly string[] = ['none', 'square', 'piece', 'own_piece', 'enemy_piece'];
const PHASES: readonly string[] = ['draw', 'main1', 'move', 'main2', 'end_turn'];

/** Il mock si fida del proprio file ma lo verifica all'avvio, così un errore di editing emerge subito. */
function loadCatalog(raw: unknown): MockSpell[] {
  if (!Array.isArray(raw)) throw new Error('spells.json: atteso un array');
  return raw.map((entry: unknown, index) => {
    const spell = entry as Partial<MockSpell>;
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
    return spell as MockSpell;
  });
}

export const CATALOG: readonly MockSpell[] = loadCatalog(rawCatalog);
export const RAW_CATALOG: unknown = rawCatalog;

export function findSpell(id: string): MockSpell | undefined {
  return CATALOG.find((spell) => spell.id === id);
}

/** Composizione del mazzo di Fase 1 (briefing §3.4): 40 carte, identico per i due giocatori. */
export const DECK_COMPOSITION: Readonly<Record<string, number>> = {
  shield: 10,
  ice_age: 8,
  greed: 6,
  recover: 6,
  teleport: 6,
  fireball: 4,
};
