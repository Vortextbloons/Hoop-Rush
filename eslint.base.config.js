import tseslint from 'typescript-eslint';

export function sharedEslintBase(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ['dist/', '**/*.gen.ts'] },
    {
      files: ['**/*.ts'],
      extends: [tseslint.configs.strictTypeChecked],
      rules: {
        '@typescript-eslint/no-meaningless-void-operator': 'off',
      },
      languageOptions: {
        parserOptions: {
          projectService: {},
          tsconfigRootDir,
        },
      },
    },
    {
      files: ['**/*.test.ts'],
      rules: {
        // Bun 1.4.4 types `.rejects`/`.resolves` as synchronous, but their runtime assertions are async.
        '@typescript-eslint/await-thenable': 'off',
        '@typescript-eslint/no-confusing-void-expression': 'off',
      },
    },
  );
}
