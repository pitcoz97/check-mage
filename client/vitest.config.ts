import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'mock-server/**/*.test.ts', 'tests/**/*.test.ts'],
    // I test di componenti dichiarano `// @vitest-environment jsdom`.
    environment: 'node',
    testTimeout: 30_000,
  },
});
