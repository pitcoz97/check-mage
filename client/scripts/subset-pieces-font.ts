/**
 * Ritaglia Noto Sans Symbols 2 ai soli glifi dei pezzi usati dal design (REDESIGN_PLAN.md §10, D2).
 *
 * Il design disegna entrambi i colori con i glifi *pieni* ♚♛♜♝♞♟ (U+265A–265F), colorati dal CSS: il font intero
 * del sottoinsieme "symbols" pesa centinaia di KB, questi sei glifi pochi. Il file prodotto è committato, quindi lo
 * script serve solo quando cambia la sorgente:
 *
 *   npm run fonts:pieces
 *
 * La licenza (SIL OFL 1.1, nessun Reserved Font Name) va distribuita insieme al font: la copia accanto al file.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import subsetFont from 'subset-font';

const PIECE_GLYPHS = '♚♛♜♝♞♟';

const require = createRequire(import.meta.url);
const SOURCE_DIR = dirname(require.resolve('@fontsource/noto-sans-symbols-2/package.json'));
const SOURCE = join(SOURCE_DIR, 'files', 'noto-sans-symbols-2-symbols-400-normal.woff2');
const OUT_DIR = join(import.meta.dirname, '..', 'src', 'design', 'fonts');

const subset = await subsetFont(readFileSync(SOURCE), PIECE_GLYPHS, { targetFormat: 'woff2' });
writeFileSync(join(OUT_DIR, 'checkmage-pieces.woff2'), subset);
copyFileSync(join(SOURCE_DIR, 'LICENSE'), join(OUT_DIR, 'OFL.txt'));
process.stdout.write(`checkmage-pieces.woff2: ${subset.length} byte (sorgente ${readFileSync(SOURCE).length})\n`);
