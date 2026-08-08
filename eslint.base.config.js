import tseslint from 'typescript-eslint';

export function sharedEslintBase(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ['dist/'] },
    {
      files: ['**/*.ts'],
      extends: [tseslint.configs.strictTypeChecked],
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
