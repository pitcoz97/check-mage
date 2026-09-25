import { describe, expect, it } from 'vitest';

import { E2E_SCENARIOS, runE2E } from '../scripts/e2e-match';

describe('e2e contro il mock', () => {
  it(
    'tutti gli scenari completano la partita passando solo per l’adapter',
    async () => {
      const reports = await runE2E(E2E_SCENARIOS);
      const failures = reports.filter((r) => !r.ok).map((r) => ({ scenario: r.name, problems: r.problems }));
      expect(failures).toEqual([]);
    },
    180_000,
  );
});
