/**
 * Controllo prima della pubblicazione (P4): i testi legali non devono contenere segnaposto. Fallisce (codice 1)
 * finché `src/legal/config.ts` ha valori tra parentesi quadre; il build del deploy (deploy/caddy/Dockerfile) lo
 * esegue prima di costruire il client, così il sito non va online senza titolare e contatto.
 *
 * Uso: `npm run legal:check`.
 */

import { unfilledPlaceholders } from '../src/legal/config';

const missing = unfilledPlaceholders();
if (missing.length > 0) {
  process.stderr.write(
    [
      'Documenti legali non pronti: compila client/src/legal/config.ts (guida: docs/legal/README.md).',
      ...missing.map((value) => `  - ancora da compilare: ${value}`),
      '',
    ].join('\n'),
  );
  process.exit(1);
}
process.stdout.write('Documenti legali pronti.\n');
