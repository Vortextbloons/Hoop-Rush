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
          projectService: {
            allowDefaultProject: ['vitest.config.ts'],
          },
          tsconfigRootDir,
        },
      },
    },
  );
}
