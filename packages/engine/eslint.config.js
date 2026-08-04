import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/'] },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
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
