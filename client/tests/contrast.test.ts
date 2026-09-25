import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guardiano di D4 (REDESIGN_PLAN.md §10): i colori del design restano fedeli, ma ogni coppia testo/superficie usata
 * dall'interfaccia deve stare almeno a 4.5:1 (WCAG AA per il testo normale). I valori si leggono da tokens.css, quindi
 * un token cambiato in peggio fa fallire il test.
 */

const TOKENS = readFileSync(join(import.meta.dirname, '..', 'src', 'design', 'tokens.css'), 'utf8');
const ROOT = TOKENS.slice(TOKENS.indexOf(':root'), TOKENS.indexOf('}', TOKENS.indexOf(':root')));

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(ROOT);
  if (match?.[1] === undefined) throw new Error(`token --${name} assente`);
  const value = match[1].trim();
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (alias?.[1] !== undefined) return token(alias[1]);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`token --${name} non è un colore pieno: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const DARK_SURFACES = ['bg-nav', 'bg-app', 'bg-sunken', 'bg-panel'];

/** Testo su ogni superficie scura dove può comparire. */
const TEXT_ON_DARK: readonly [string, readonly string[]][] = [
  ['text-primary', [...DARK_SURFACES, 'bg-quiet', 'bg-elevated', 'bg-arcane']],
  ['text-muted', [...DARK_SURFACES, 'bg-quiet', 'bg-elevated', 'bg-arcane']],
  ['text-tertiary', [...DARK_SURFACES, 'bg-quiet', 'bg-elevated']],
  // Il testo più spento sta solo su pannelli e superfici incassate (fasi future, numeri dello storico).
  ['text-faint', DARK_SURFACES],
  ['accent', [...DARK_SURFACES, 'bg-elevated']],
  ['gold-bright', [...DARK_SURFACES, 'bg-elevated', 'bg-arcane']],
  ['arcane-bright', [...DARK_SURFACES, 'bg-elevated']],
  ['arcane-pale', [...DARK_SURFACES, 'bg-arcane']],
  ['play-bright', [...DARK_SURFACES, 'bg-elevated']],
  ['danger', [...DARK_SURFACES, 'bg-elevated']],
];

/** Testo sulle superfici colorate: pulsanti, orologio attivo, box di testo della carta. */
const TEXT_ON_COLOR: readonly [string, string][] = [
  ['text-on-play', 'play'],
  ['text-on-gold', 'gold'],
  ['text-on-danger', 'danger-surface'],
  ['text-on-parchment', 'bg-parchment'],
  ['bg-app', 'bg-parchment'],
];

describe('contrasto dei token (AA, 4.5:1)', () => {
  it.each(TEXT_ON_DARK.flatMap(([text, surfaces]) => surfaces.map((surface) => [text, surface] as const)))(
    '%s su %s',
    (text, surface) => {
      expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(TEXT_ON_COLOR)('%s su %s', (text, surface) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('il colore spento del design (#7F786E) non passerebbe: la correzione è necessaria', () => {
    expect(contrast('#7f786e', token('bg-sunken'))).toBeLessThan(4.5);
  });
});
