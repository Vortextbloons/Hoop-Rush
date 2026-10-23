import eslintPluginSvelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.svelte-kit/', 'build/', 'dist/'] },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['bun-test-preload.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Same rationale as eslint.base.config.js: the `void x;` unused marker
      // idiom is used throughout the codebase.
      '@typescript-eslint/no-meaningless-void-operator': 'off',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.svelte', 'src/**/*.svelte.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/testing/**', '**/fake-*', '**/*-fake-*'],
              message: 'Test doubles live under testing/ and may only be imported by test files.',
            },
          ],
        },
      ],
    },
  },
  ...eslintPluginSvelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    rules: {
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  {
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['bun-test-preload.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
