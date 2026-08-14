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
          allowDefaultProject: ['vitest.config.ts', 'playwright.config.ts', 'e2e/*.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
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
          allowDefaultProject: ['vitest.config.ts', 'playwright.config.ts', 'e2e/*.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
