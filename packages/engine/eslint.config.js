import tseslint from 'typescript-eslint';
import { sharedEslintBase } from '../../eslint.base.config.js';

export default tseslint.config(
  ...sharedEslintBase(import.meta.dirname),
  // Determinism is a hard contract: simulation state must never come from
  // platform randomness or wall clocks. Web UI ids may use them; the engine
  // may not (see AGENTS.md, "Design determinism intentionally").
  {
    files: ['src/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Math.random',
          message: 'engine simulation must use injected seeded RNG (createRng)',
        },
        { name: 'Date.now', message: 'engine code must not read the wall clock; inject clocks' },
        { name: 'performance', message: 'engine code must not read the wall clock; inject clocks' },
      ],
    },
  },
  // Tests may time their own runs (e.g. the perf contract in sim/game.test.ts)
  // but must still never draw unseeded randomness or wall-clock seeds.
  {
    files: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Math.random', message: 'engine tests must use injected seeded RNG (createRng)' },
        { name: 'Date.now', message: 'engine tests must not seed from the wall clock' },
      ],
    },
  },
  // Season Run domain modules stay pure TypeScript (spec/2.0/07): no UI,
  // persistence, worker, browser, or network imports.
  {
    files: ['src/season/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['*svelte*'], message: 'Season Run domain must not import Svelte' },
            { group: ['*dexie*'], message: 'Season Run domain must not import persistence' },
            { group: ['node:*'], message: 'Season Run domain must not import Node APIs' },
            { group: ['*worker*'], message: 'Season Run domain must not import workers' },
            {
              group: ['*supabase*'],
              message: 'Season Run domain must not import network services',
            },
            {
              group: ['*fetch*', '*browser*'],
              message: 'Season Run domain must not import network/browser APIs',
            },
          ],
        },
      ],
    },
  },
);
