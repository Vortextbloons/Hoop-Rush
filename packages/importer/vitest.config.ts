import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The importer is transform-heavy (zod schemas over full data files).
    // Under full parallel package execution, more workers only duplicate the
    // transform work; four keep the suite fast without oversubscribing.
    maxWorkers: 4,
  },
});
