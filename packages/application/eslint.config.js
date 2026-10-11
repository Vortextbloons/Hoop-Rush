import tseslint from 'typescript-eslint';
import { sharedEslintBase } from '../../eslint.base.config.js';
export default tseslint.config(...sharedEslintBase(import.meta.dirname), {
  files: ['src/**'],
  rules: {
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message: 'application code must use injected ids and seeds',
      },
      {
        object: 'Date',
        property: 'now',
        message: 'application code must use the injected clock port',
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'performance', message: 'application code must use the injected clock port' },
    ],
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@hoop-rush/persistence',
            allowTypeImports: true,
            message:
              'application code may import persistence types only; runtime access goes through the persistence port',
          },
        ],
        patterns: [
          { group: ['*svelte*'], message: 'application package must not import Svelte' },
          { group: ['*dexie*'], message: 'application package must not import Dexie' },
          {
            group: ['node:*'],
            message: 'application package must not import Node APIs',
          },
          { group: ['*worker*'], message: 'application package must not import workers' },
          {
            group: ['*supabase*'],
            message: 'application package must not import network services',
          },
          {
            group: ['*fetch*', '*browser*'],
            message: 'application package must not import network/browser APIs',
          },
        ],
      },
    ],
  },
});
