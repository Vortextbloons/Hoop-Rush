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
    rules: {
      // The storage layer intentionally omits fields via rest destructuring
      // (`const { omit, ...rest } = record`); the omitted keys are the point
      // of the idiom and should not be reported as unused.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
);
