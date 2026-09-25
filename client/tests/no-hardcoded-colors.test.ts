import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Criterio di accettazione dello Step 1: nessun colore hardcoded fuori da `src/design/tokens.css`.
 * Tailwind non ha palette di default (theme.css), quindi resta da controllare il testo dei sorgenti.
 */

const ROOT = join(import.meta.dirname, '..', 'src');
const TOKENS = join(ROOT, 'design', 'tokens.css');

const PATTERNS: readonly [string, RegExp][] = [
  ['esadecimale', /#[0-9a-fA-F]{3,8}\b/],
  ['funzione colore', /\b(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/],
  ['colore nominato in stile', /\b(color|background(-color)?|border(-color)?|fill|stroke)\s*:\s*['"]?(red|green|blue|white|black|gray|grey|yellow|orange|purple)\b/i],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('nessun colore hardcoded', () => {
  it('i sorgenti usano solo i token', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      if (file === TOKENS) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const [label, pattern] of PATTERNS) {
            if (pattern.test(line)) offenders.push(`${relative(ROOT, file)}:${index + 1} (${label}): ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
