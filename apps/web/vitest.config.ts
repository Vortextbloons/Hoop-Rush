import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No testable units until M1 screens introduce component/lib code.
    passWithNoTests: true,
  },
});
