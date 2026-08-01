import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright journeys live in e2e/ and run via `pnpm e2e`.
    exclude: [...defaultExclude, 'e2e/**'],
    // No testable units yet beyond the journeys; keep the gate green.
    passWithNoTests: true,
  },
});
